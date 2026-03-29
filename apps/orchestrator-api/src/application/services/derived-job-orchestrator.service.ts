import { Inject, Injectable } from '@nestjs/common';
import {
  VersionStampService,
  createPendingAttempt,
  createReprocessingJob,
  markJobAsPublishPending,
  markJobAsStored,
  markJobAsValidated,
  type JobAttemptRecord,
  type ProcessingJobRecord
} from '@document-parser/document-processing-domain';
import type { AuditActor } from '@document-parser/shared-kernel';
import type {
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  ProcessingJobRepositoryPort,
  QueuePublicationOutboxRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import {
  buildOrchestratorQueuePublicationOutboxRecord,
  type OrchestratorQueuePublicationFinalizationMetadata
} from './queue-publication-outbox-dispatcher.service';

type DerivedJobStoredContext = {
  job: ProcessingJobRecord;
  attempt: JobAttemptRecord;
};

@Injectable()
export class DerivedJobOrchestrator {
  private readonly versionStamps = new VersionStampService();

  public constructor(
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.QUEUE_PUBLICATION_OUTBOX_REPOSITORY)
    private readonly outbox: QueuePublicationOutboxRepositoryPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort
  ) {}

  public async execute(input: {
    actor: AuditActor;
    originalJob: ProcessingJobRecord;
    queueName: string;
    traceId: string;
    now: Date;
    onStored?: (context: DerivedJobStoredContext) => Promise<void>;
    queuedFinalizationMetadata: OrchestratorQueuePublicationFinalizationMetadata;
  }): Promise<DerivedJobStoredContext> {
    const { pipelineVersion, outputVersion } = this.versionStamps.buildJobStamp({
      pipelineVersion: input.originalJob.pipelineVersion,
      outputVersion: input.originalJob.outputVersion
    });
    const storedJob = markJobAsStored({
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
    const job = markJobAsPublishPending({
      job: storedJob,
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
      await this.outbox.save(
        buildOrchestratorQueuePublicationOutboxRecord({
          outboxId: this.idGenerator.next('outbox'),
          flowType: input.queuedFinalizationMetadata.replayDeadLetterId === undefined ? 'reprocess' : 'replay',
          dispatchKind: 'publish_requested',
          queueName: job.queueName,
          messageBase: {
            documentId: job.documentId,
            jobId: job.jobId,
            attemptId: attempt.attemptId,
            traceId: input.traceId,
            requestedMode: job.requestedMode,
            pipelineVersion: job.pipelineVersion
          },
          finalizationMetadata: {
            ...input.queuedFinalizationMetadata,
            auditAggregateType: input.queuedFinalizationMetadata.auditAggregateType ?? 'PROCESSING_JOB',
            auditAggregateId: input.queuedFinalizationMetadata.auditAggregateId ?? job.jobId,
            auditMetadata: {
              jobId: job.jobId,
              attemptId: attempt.attemptId,
              ...(input.queuedFinalizationMetadata.auditMetadata ?? {})
            }
          },
          now: input.now
        })
      );
      await input.onStored?.({
        job,
        attempt
      });
    });

    return {
      job,
      attempt
    };
  }
}
