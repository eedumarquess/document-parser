import { Inject, Injectable } from '@nestjs/common';
import {
  JobStatus,
  ErrorCode,
  QueuePublicationOutboxStatus,
  type QueuePublicationOutboxRecord,
  type AuditActor
} from '@document-parser/shared-kernel';
import {
  failAttemptQueuePublication,
  recordJobError,
  type JobAttemptRecord,
  type ProcessingJobRecord
} from '@document-parser/document-processing-domain';
import type {
  JobAttemptRepositoryPort,
  ProcessingJobRepositoryPort,
  QueuePublicationOutboxRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';
import { AuditEventRecorder } from './audit-event-recorder.service';

type QueuePublicationFailureResult = {
  job: ProcessingJobRecord;
  attempt: JobAttemptRecord;
  outboxRecord: QueuePublicationOutboxRecord;
};

@Injectable()
export class QueuePublicationFailureHandler {
  public constructor(
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.QUEUE_PUBLICATION_OUTBOX_REPOSITORY)
    private readonly outbox: QueuePublicationOutboxRepositoryPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly auditEventRecorder: AuditEventRecorder
  ) {}

  public async handle(input: {
    actor: AuditActor;
    job: ProcessingJobRecord;
    attempt: JobAttemptRecord;
    outboxRecord: QueuePublicationOutboxRecord;
    traceId: string;
    now: Date;
    errorMessage: string;
    metadata: Record<string, unknown>;
  }): Promise<QueuePublicationFailureResult> {
    const failedJob = recordJobError({
      job: input.job,
      errorCode: ErrorCode.TRANSIENT_FAILURE,
      errorMessage: input.errorMessage,
      now: input.now,
      status: JobStatus.FAILED
    });
    const failedAttempt = failAttemptQueuePublication({
      attempt: input.attempt,
      errorCode: ErrorCode.TRANSIENT_FAILURE,
      errorDetails: {
        message: input.errorMessage
      },
      now: input.now
    });
    const failedOutboxRecord = {
      ...input.outboxRecord,
      status: QueuePublicationOutboxStatus.FAILED,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastError: input.errorMessage,
      updatedAt: input.now,
      retentionUntil: this.retentionPolicy.calculateQueuePublicationOutboxRetentionUntil(input.now)
    };

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(failedJob);
      await this.attempts.save(failedAttempt);
      await this.outbox.save(failedOutboxRecord);
      await this.auditEventRecorder.record({
        eventType: 'PROCESSING_JOB_QUEUEING_FAILED',
        aggregateType: 'PROCESSING_JOB',
        aggregateId: input.job.jobId,
        traceId: input.traceId,
        actor: input.actor,
        metadata: input.metadata,
        createdAt: input.now
      });
    });

    return {
      job: failedJob,
      attempt: failedAttempt,
      outboxRecord: failedOutboxRecord
    };
  }
}
