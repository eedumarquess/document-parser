import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type AuditActor,
  type JobStatus
} from '@document-parser/shared-kernel';
import {
  recordJobError,
  type ProcessingJobRecord
} from '@document-parser/document-processing-domain';
import type { ProcessingJobRepositoryPort, UnitOfWorkPort } from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { AuditEventRecorder } from './audit-event-recorder.service';

@Injectable()
export class QueuePublicationFailureHandler {
  public constructor(
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly auditEventRecorder: AuditEventRecorder
  ) {}

  public async handle(input: {
    actor: AuditActor;
    job: ProcessingJobRecord;
    traceId: string;
    now: Date;
    errorMessage: string;
    eventType: string;
    aggregateType?: string;
    aggregateId?: string;
    metadata: Record<string, unknown>;
    status?: JobStatus;
  }): Promise<ProcessingJobRecord> {
    const failedJob = recordJobError({
      job: input.job,
      errorCode: ErrorCode.TRANSIENT_FAILURE,
      errorMessage: input.errorMessage,
      now: input.now,
      status: input.status
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(failedJob);
      await this.auditEventRecorder.record({
        eventType: input.eventType,
        aggregateType: input.aggregateType ?? 'PROCESSING_JOB',
        aggregateId: input.aggregateId ?? input.job.jobId,
        traceId: input.traceId,
        actor: input.actor,
        metadata: input.metadata,
        createdAt: input.now
      });
    });

    return failedJob;
  }
}
