import { Inject, Injectable } from '@nestjs/common';
import {
  VersionStampService,
  createPendingAttempt,
  createReprocessingJob,
  markAttemptAsQueued,
  markJobAsQueued,
  markJobAsStored,
  markJobAsValidated,
  recordJobError,
  type JobAttemptRecord
} from '@document-parser/document-processing-domain';
import {
  DEFAULT_PROCESSING_QUEUE_NAME,
  ErrorCode,
  NotFoundError,
  TransientFailureError,
  type AuditActor,
  type ProcessingJobRequestedMessage,
  ValidationError
} from '@document-parser/shared-kernel';
import type { JobResponse } from '../../contracts/http';
import type { ProcessingJobRecord } from '../../contracts/models';
import type {
  AuditPort,
  AuthorizationPort,
  ClockPort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  ProcessingJobRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type { ReprocessDocumentCommand } from '../commands/reprocess-document.command';

@Injectable()
export class ReprocessDocumentUseCase {
  private readonly versionStamps = new VersionStampService();

  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort
  ) {}

  public async execute(command: ReprocessDocumentCommand, actor: AuditActor): Promise<JobResponse> {
    this.authorization.ensureCanReprocess(actor);
    if (command.reason.trim() === '') {
      throw new ValidationError('Reprocess reason is required');
    }

    const originalJob = await this.jobs.findById(command.jobId);
    if (originalJob === undefined) {
      throw new NotFoundError('Processing job not found', { jobId: command.jobId });
    }

    const now = this.clock.now();
    const { pipelineVersion, outputVersion } = this.versionStamps.buildJobStamp({
      pipelineVersion: originalJob.pipelineVersion,
      outputVersion: originalJob.outputVersion
    });
    const validatedJob = markJobAsValidated({
      job: createReprocessingJob({
        jobId: this.idGenerator.next('job'),
        documentId: originalJob.documentId,
        requestedMode: originalJob.requestedMode,
        queueName: DEFAULT_PROCESSING_QUEUE_NAME,
        pipelineVersion,
        outputVersion,
        requestedBy: actor,
        reprocessOfJobId: originalJob.jobId,
        now
      }),
      now
    });
    const reprocessedJob = markJobAsStored({
      job: validatedJob,
      now
    });
    const attempt = createPendingAttempt({
      attemptId: this.idGenerator.next('attempt'),
      jobId: reprocessedJob.jobId,
      attemptNumber: 1,
      pipelineVersion: reprocessedJob.pipelineVersion,
      now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(reprocessedJob);
      await this.attempts.save(attempt);
      await this.audit.record({
        eventId: this.idGenerator.next('audit'),
        eventType: 'JOB_REPROCESSING_REQUESTED',
        actor,
        metadata: {
          jobId: reprocessedJob.jobId,
          reprocessOfJobId: originalJob.jobId,
          reason: command.reason
        },
        createdAt: now
      });
    });
    const message: ProcessingJobRequestedMessage = {
      documentId: originalJob.documentId,
      jobId: reprocessedJob.jobId,
      attemptId: attempt.attemptId,
      requestedMode: originalJob.requestedMode,
      pipelineVersion: originalJob.pipelineVersion,
      publishedAt: now.toISOString()
    };

    try {
      await this.publisher.publishRequested(message);
    } catch (error) {
      await this.markJobAsPublishFailed({
        actor,
        job: reprocessedJob,
        now,
        errorMessage: error instanceof Error ? error.message : 'Unexpected queue publishing failure'
      });
      throw new TransientFailureError('Reprocessing job persisted but queue publication failed', {
        jobId: reprocessedJob.jobId,
        documentId: reprocessedJob.documentId
      });
    }

    const queuedJob = markJobAsQueued({
      job: reprocessedJob,
      now
    });
    const queuedAttempt = markAttemptAsQueued({
      attempt
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(queuedJob);
      await this.attempts.save(queuedAttempt);
      await this.audit.record({
        eventId: this.idGenerator.next('audit'),
        eventType: 'PROCESSING_JOB_QUEUED',
        actor,
        metadata: {
          jobId: queuedJob.jobId,
          reprocessOfJobId: originalJob.jobId,
          attemptId: queuedAttempt.attemptId
        },
        createdAt: now
      });
    });

    return {
      jobId: queuedJob.jobId,
      documentId: queuedJob.documentId,
      status: queuedJob.status,
      requestedMode: queuedJob.requestedMode,
      pipelineVersion: queuedJob.pipelineVersion,
      outputVersion: queuedJob.outputVersion,
      reusedResult: queuedJob.reusedResult,
      createdAt: queuedJob.createdAt.toISOString()
    };
  }

  private async markJobAsPublishFailed(input: {
    actor: AuditActor;
    job: ProcessingJobRecord;
    now: Date;
    errorMessage: string;
  }): Promise<void> {
    const failedJob = recordJobError({
      job: input.job,
      errorCode: ErrorCode.TRANSIENT_FAILURE,
      errorMessage: input.errorMessage,
      now: input.now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(failedJob);
      await this.audit.record({
        eventId: this.idGenerator.next('audit'),
        eventType: 'PROCESSING_JOB_QUEUEING_FAILED',
        actor: input.actor,
        metadata: {
          jobId: input.job.jobId,
          errorMessage: input.errorMessage
        },
        createdAt: input.now
      });
    });
  }
}
