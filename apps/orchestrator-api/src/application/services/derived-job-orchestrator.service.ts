import { Inject, Injectable } from '@nestjs/common';
import {
  VersionStampService,
  createPendingAttempt,
  createReprocessingJob,
  markAttemptAsQueued,
  markJobAsQueued,
  markJobAsStored,
  markJobAsValidated,
  type JobAttemptRecord,
  type ProcessingJobRecord
} from '@document-parser/document-processing-domain';
import {
  TransientFailureError,
  type AuditActor,
  type ProcessingJobRequestedMessage
} from '@document-parser/shared-kernel';
import type {
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  ProcessingJobRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { QueuePublicationFailureHandler } from './queue-publication-failure-handler.service';

type DerivedJobStoredContext = {
  job: ProcessingJobRecord;
  attempt: JobAttemptRecord;
};

type DerivedJobQueuedContext = {
  job: ProcessingJobRecord;
  attempt: JobAttemptRecord;
  queuedJob: ProcessingJobRecord;
  queuedAttempt: JobAttemptRecord;
};

@Injectable()
export class DerivedJobOrchestrator {
  private readonly versionStamps = new VersionStampService();

  public constructor(
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly queuePublicationFailureHandler: QueuePublicationFailureHandler
  ) {}

  public async execute(input: {
    actor: AuditActor;
    originalJob: ProcessingJobRecord;
    queueName: string;
    traceId: string;
    now: Date;
    onStored?: (context: DerivedJobStoredContext) => Promise<void>;
    onQueued?: (context: DerivedJobQueuedContext) => Promise<void>;
    publishFailure: {
      eventType: string;
      failureMessage: string;
      context: (context: { job: ProcessingJobRecord }) => Record<string, string>;
      metadata: (context: { job: ProcessingJobRecord; errorMessage: string }) => Record<string, unknown>;
    };
  }): Promise<DerivedJobQueuedContext> {
    const { pipelineVersion, outputVersion } = this.versionStamps.buildJobStamp({
      pipelineVersion: input.originalJob.pipelineVersion,
      outputVersion: input.originalJob.outputVersion
    });
    const job = markJobAsStored({
      job: markJobAsValidated({
        job: createReprocessingJob({
          jobId: this.idGenerator.next('job'),
          documentId: input.originalJob.documentId,
          requestedMode: input.originalJob.requestedMode,
          queueName: input.queueName,
          pipelineVersion,
          outputVersion,
          requestedBy: input.actor,
          reprocessOfJobId: input.originalJob.jobId,
          now: input.now
        }),
        now: input.now
      }),
      now: input.now
    });
    const attempt = createPendingAttempt({
      attemptId: this.idGenerator.next('attempt'),
      jobId: job.jobId,
      attemptNumber: 1,
      pipelineVersion: job.pipelineVersion,
      now: input.now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(job);
      await this.attempts.save(attempt);
      await input.onStored?.({
        job,
        attempt
      });
    });

    const message: ProcessingJobRequestedMessage = {
      documentId: job.documentId,
      jobId: job.jobId,
      attemptId: attempt.attemptId,
      traceId: input.traceId,
      requestedMode: job.requestedMode,
      pipelineVersion: job.pipelineVersion,
      publishedAt: input.now.toISOString()
    };

    try {
      await this.publisher.publishRequested(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected queue publishing failure';
      await this.queuePublicationFailureHandler.handle({
        actor: input.actor,
        job,
        traceId: input.traceId,
        now: input.now,
        errorMessage,
        eventType: input.publishFailure.eventType,
        metadata: input.publishFailure.metadata({
          job,
          errorMessage
        })
      });
      throw new TransientFailureError(input.publishFailure.failureMessage, input.publishFailure.context({ job }));
    }

    const queuedJob = markJobAsQueued({
      job,
      now: input.now
    });
    const queuedAttempt = markAttemptAsQueued({
      attempt
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(queuedJob);
      await this.attempts.save(queuedAttempt);
      await input.onQueued?.({
        job,
        attempt,
        queuedJob,
        queuedAttempt
      });
    });

    return {
      job,
      attempt,
      queuedJob,
      queuedAttempt
    };
  }
}
