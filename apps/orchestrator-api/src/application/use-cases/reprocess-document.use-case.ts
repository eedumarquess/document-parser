import { Inject, Injectable } from '@nestjs/common';
import {
  JobStatus,
  NotFoundError,
  type AuditActor,
  type ProcessingJobRequestedMessage,
  ValidationError
} from '@document-parser/shared-kernel';
import type { JobResponse } from '../../contracts/http';
import type {
  AuditPort,
  AuthorizationPort,
  ClockPort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  ProcessingJobRepositoryPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { ProcessingJobEntity } from '../../domain/entities/processing-job.entity';
import type { ReprocessDocumentCommand } from '../commands/reprocess-document.command';

@Injectable()
export class ReprocessDocumentUseCase {
  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort
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
    const newJobId = this.idGenerator.next('job');
    const attemptId = this.idGenerator.next('attempt');
    const reprocessedJob = ProcessingJobEntity.createQueued({
      jobId: newJobId,
      documentId: originalJob.documentId,
      requestedMode: originalJob.requestedMode,
      pipelineVersion: originalJob.pipelineVersion,
      outputVersion: originalJob.outputVersion,
      requestedBy: actor,
      forceReprocess: true,
      status: JobStatus.REPROCESSED,
      reprocessOfJobId: originalJob.jobId,
      now
    });
    await this.jobs.save(reprocessedJob);

    const queuedJob = {
      ...reprocessedJob,
      status: JobStatus.QUEUED,
      queuedAt: now,
      updatedAt: now
    };
    const attempt = ProcessingJobEntity.createAttempt({
      attemptId,
      jobId: newJobId,
      attemptNumber: 1,
      pipelineVersion: originalJob.pipelineVersion,
      now
    });

    await this.jobs.save(queuedJob);
    await this.attempts.save(attempt);

    const message: ProcessingJobRequestedMessage = {
      documentId: originalJob.documentId,
      jobId: newJobId,
      attemptId,
      requestedMode: originalJob.requestedMode,
      pipelineVersion: originalJob.pipelineVersion,
      publishedAt: now.toISOString()
    };

    await this.publisher.publish(message);
    await this.audit.record({
      eventId: this.idGenerator.next('audit'),
      eventType: 'JOB_REPROCESSING_REQUESTED',
      actor,
      metadata: {
        jobId: newJobId,
        reprocessOfJobId: originalJob.jobId,
        reason: command.reason
      },
      createdAt: now
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
}
