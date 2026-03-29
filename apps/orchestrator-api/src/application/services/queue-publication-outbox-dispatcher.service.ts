import { randomUUID } from 'crypto';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ErrorCode,
  QueuePublicationOutboxStatus,
  type AuditActor,
  type ProcessingJobRequestedMessage,
  type QueuePublicationDispatchKind,
  type QueuePublicationFlowType,
  type QueuePublicationMessageBase,
  type QueuePublicationOutboxRecord
} from '@document-parser/shared-kernel';
import {
  finalizeAttemptQueuePublication,
  finalizeJobQueuePublication
} from '@document-parser/document-processing-domain';
import type {
  ClockPort,
  DeadLetterRepositoryPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  LoggingPort,
  MetricsPort,
  ProcessingJobRepositoryPort,
  QueuePublicationOutboxRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';
import { AuditEventRecorder } from './audit-event-recorder.service';
import { QueuePublicationFailureHandler } from './queue-publication-failure-handler.service';

export const ORCHESTRATOR_QUEUE_PUBLICATION_OWNER_SERVICE = 'orchestrator-api';

export type QueuePublicationDispatcherRuntime = {
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
};

export const DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME: QueuePublicationDispatcherRuntime = {
  pollIntervalMs: 500,
  batchSize: 20,
  leaseMs: 30_000
};

export type OrchestratorQueuePublicationFinalizationMetadata = {
  actor: AuditActor;
  auditEventType: string;
  auditAggregateType?: string;
  auditAggregateId?: string;
  auditMetadata?: Record<string, unknown>;
  replayDeadLetterId?: string;
};

export function buildOrchestratorQueuePublicationOutboxRecord(input: {
  outboxId: string;
  flowType: QueuePublicationFlowType;
  dispatchKind: QueuePublicationDispatchKind;
  retryAttempt?: number;
  queueName: string;
  messageBase: QueuePublicationMessageBase;
  finalizationMetadata: OrchestratorQueuePublicationFinalizationMetadata;
  now: Date;
}): QueuePublicationOutboxRecord {
  return {
    outboxId: input.outboxId,
    ownerService: ORCHESTRATOR_QUEUE_PUBLICATION_OWNER_SERVICE,
    flowType: input.flowType,
    dispatchKind: input.dispatchKind,
    retryAttempt: input.retryAttempt,
    jobId: input.messageBase.jobId,
    documentId: input.messageBase.documentId,
    attemptId: input.messageBase.attemptId,
    queueName: input.queueName,
    messageBase: input.messageBase,
    finalizationMetadata: input.finalizationMetadata as Record<string, unknown>,
    status: QueuePublicationOutboxStatus.PENDING,
    publishAttempts: 0,
    availableAt: input.now,
    createdAt: input.now,
    updatedAt: input.now
  };
}

@Injectable()
export class QueuePublicationOutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly leaseOwner = `orchestrator-outbox-dispatcher:${process.pid}:${randomUUID()}`;
  private timer?: NodeJS.Timeout;
  private dispatching = false;

  public constructor(
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.DEAD_LETTER_REPOSITORY) private readonly deadLetters: DeadLetterRepositoryPort,
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.QUEUE_PUBLICATION_OUTBOX_REPOSITORY)
    private readonly outbox: QueuePublicationOutboxRepositoryPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.QUEUE_PUBLICATION_DISPATCHER_RUNTIME)
    private readonly runtime: QueuePublicationDispatcherRuntime,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly auditEventRecorder: AuditEventRecorder,
    private readonly queuePublicationFailureHandler: QueuePublicationFailureHandler
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.dispatchAvailable();
    }, this.runtime.pollIntervalMs);
    void this.dispatchAvailable();
  }

  public onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public async dispatchAvailable(): Promise<void> {
    if (this.dispatching) {
      return;
    }
    this.dispatching = true;

    try {
      const now = this.clock.now();
      const claimed = await this.outbox.claimAvailable({
        ownerService: ORCHESTRATOR_QUEUE_PUBLICATION_OWNER_SERVICE,
        now,
        limit: this.runtime.batchSize,
        leaseMs: this.runtime.leaseMs,
        leaseOwner: this.leaseOwner
      });

      for (const record of claimed) {
        await this.dispatchRecord(record);
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async dispatchRecord(record: QueuePublicationOutboxRecord): Promise<void> {
    const publishedAt = this.clock.now();
    const message: ProcessingJobRequestedMessage = {
      ...record.messageBase,
      publishedAt: publishedAt.toISOString()
    };

    try {
      await this.publish(record, message);
      await this.finalizePublished(record, publishedAt, this.clock.now());
      await this.metrics.increment({
        name: 'orchestrator.queue_publication_outbox.published',
        tags: this.buildMetricTags(record)
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected outbox dispatch failure';
      await this.finalizePublishFailed(record, errorMessage);
      await this.metrics.increment({
        name: 'orchestrator.queue_publication_outbox.publish_failed',
        tags: this.buildMetricTags(record)
      });
      await this.logging.log({
        level: 'error',
        message: 'Orchestrator outbox publication failed',
        context: 'QueuePublicationOutboxDispatcherService',
        traceId: record.messageBase.traceId,
        data: {
          outboxId: record.outboxId,
          flowType: record.flowType,
          dispatchKind: record.dispatchKind,
          errorMessage
        },
        recordedAt: this.clock.now()
      });
    }
  }

  private async publish(
    record: QueuePublicationOutboxRecord,
    message: ProcessingJobRequestedMessage
  ): Promise<void> {
    if (record.dispatchKind === 'publish_retry') {
      await this.publisher.publishRetry(message, record.retryAttempt ?? 1);
      return;
    }

    await this.publisher.publishRequested(message);
  }

  private async finalizePublished(
    record: QueuePublicationOutboxRecord,
    publishedAt: Date,
    now: Date
  ): Promise<void> {
    const metadata = record.finalizationMetadata as OrchestratorQueuePublicationFinalizationMetadata | undefined;

    await this.unitOfWork.runInTransaction(async () => {
      const [currentOutbox, currentJob, currentAttempt] = await Promise.all([
        this.outbox.findById(record.outboxId),
        this.jobs.findById(record.jobId),
        this.attempts.findById(record.attemptId)
      ]);

      if (currentOutbox === undefined || currentOutbox.status !== QueuePublicationOutboxStatus.PENDING) {
        return;
      }
      if (currentJob === undefined) {
        throw new Error(`Missing job ${record.jobId} during outbox finalization`);
      }
      if (currentAttempt === undefined) {
        throw new Error(`Missing attempt ${record.attemptId} during outbox finalization`);
      }

      await this.jobs.save(
        finalizeJobQueuePublication({
          job: currentJob,
          queuedAt: publishedAt,
          now
        })
      );
      await this.attempts.save(
        finalizeAttemptQueuePublication({
          attempt: currentAttempt
        })
      );

      if (metadata?.replayDeadLetterId !== undefined) {
        const deadLetter = await this.deadLetters.findById(metadata.replayDeadLetterId);
        if (deadLetter !== undefined && deadLetter.replayedAt === undefined) {
          await this.deadLetters.save({
            ...deadLetter,
            replayedAt: publishedAt
          });
        }
      }

      if (metadata !== undefined) {
        await this.auditEventRecorder.record({
          eventType: metadata.auditEventType,
          aggregateType: metadata.auditAggregateType,
          aggregateId: metadata.auditAggregateId,
          traceId: record.messageBase.traceId,
          actor: metadata.actor,
          metadata: metadata.auditMetadata,
          createdAt: publishedAt
        });
      }

      await this.outbox.save({
        ...currentOutbox,
        status: QueuePublicationOutboxStatus.PUBLISHED,
        publishedAt,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: undefined,
        updatedAt: now,
        retentionUntil: this.retentionPolicy.calculateQueuePublicationOutboxRetentionUntil(now)
      });
    });
  }

  private async finalizePublishFailed(record: QueuePublicationOutboxRecord, errorMessage: string): Promise<void> {
    const now = this.clock.now();
    const metadata = record.finalizationMetadata as OrchestratorQueuePublicationFinalizationMetadata | undefined;
    const [currentOutbox, currentJob, currentAttempt] = await Promise.all([
      this.outbox.findById(record.outboxId),
      this.jobs.findById(record.jobId),
      this.attempts.findById(record.attemptId)
    ]);

    if (currentOutbox === undefined || currentOutbox.status !== QueuePublicationOutboxStatus.PENDING) {
      return;
    }
    if (currentJob === undefined) {
      throw new Error(`Missing job ${record.jobId} during outbox failure finalization`);
    }
    if (currentAttempt === undefined) {
      throw new Error(`Missing attempt ${record.attemptId} during outbox failure finalization`);
    }
    if (metadata === undefined) {
      throw new Error(`Missing outbox finalization metadata for ${record.outboxId}`);
    }

    await this.queuePublicationFailureHandler.handle({
      actor: metadata.actor,
      job: currentJob,
      attempt: currentAttempt,
      outboxRecord: currentOutbox,
      traceId: record.messageBase.traceId,
      now,
      errorMessage,
      metadata: {
        jobId: currentJob.jobId,
        attemptId: currentAttempt.attemptId,
        outboxId: currentOutbox.outboxId,
        documentId: currentJob.documentId,
        flowType: currentOutbox.flowType,
        dispatchKind: currentOutbox.dispatchKind,
        errorCode: ErrorCode.TRANSIENT_FAILURE,
        errorMessage
      }
    });
  }

  private buildMetricTags(record: QueuePublicationOutboxRecord): Record<string, string> {
    return {
      ownerService: record.ownerService,
      flowType: record.flowType,
      dispatchKind: record.dispatchKind
    };
  }
}
