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
  RedactionPolicyService,
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
  LoggingPort,
  MetricsPort,
  ProcessingJobRepositoryPort,
  TracingPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';
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
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService
  ) {}

  public async execute(command: ReprocessDocumentCommand, actor: AuditActor, traceId: string): Promise<JobResponse> {
    const startedAt = Date.now();

    return this.tracing.runInSpan(
      {
        traceId,
        spanName: 'orchestrator.reprocess_document',
        attributes: {
          actorId: actor.actorId,
          jobId: command.jobId
        }
      },
      async () => {
        try {
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
            await this.recordAuditEvent({
              eventType: 'JOB_REPROCESSING_REQUESTED',
              aggregateType: 'PROCESSING_JOB',
              aggregateId: reprocessedJob.jobId,
              traceId,
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
            traceId,
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
              traceId,
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
            await this.recordAuditEvent({
              eventType: 'PROCESSING_JOB_QUEUED',
              aggregateType: 'PROCESSING_JOB',
              aggregateId: queuedJob.jobId,
              traceId,
              actor,
              metadata: {
                jobId: queuedJob.jobId,
                reprocessOfJobId: originalJob.jobId,
                attemptId: queuedAttempt.attemptId
              },
              createdAt: now
            });
          });

          await this.logging.log({
            level: 'info',
            message: 'Reprocessing job queued successfully',
            context: 'ReprocessDocumentUseCase',
            traceId,
            data: this.redactionPolicy.redact({
              jobId: queuedJob.jobId,
              reprocessOfJobId: originalJob.jobId
            }) as Record<string, unknown>,
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'orchestrator.reprocess_document.succeeded',
            traceId
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
        } catch (error) {
          await this.metrics.increment({
            name: 'orchestrator.reprocess_document.failed',
            traceId
          });
          await this.logging.log({
            level: 'error',
            message: 'Reprocessing job failed',
            context: 'ReprocessDocumentUseCase',
            traceId,
            data: this.redactionPolicy.redact({
              actorId: actor.actorId,
              jobId: command.jobId,
              errorMessage: error instanceof Error ? error.message : 'Unexpected failure'
            }) as Record<string, unknown>,
            recordedAt: this.clock.now()
          });
          throw error;
        } finally {
          await this.metrics.recordHistogram({
            name: 'orchestrator.reprocess_document.duration_ms',
            value: Date.now() - startedAt,
            traceId
          });
        }
      }
    );
  }

  private async markJobAsPublishFailed(input: {
    actor: AuditActor;
    job: ProcessingJobRecord;
    traceId: string;
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
      await this.recordAuditEvent({
        eventType: 'PROCESSING_JOB_QUEUEING_FAILED',
        aggregateType: 'PROCESSING_JOB',
        aggregateId: input.job.jobId,
        traceId: input.traceId,
        actor: input.actor,
        metadata: {
          jobId: input.job.jobId,
          errorMessage: input.errorMessage
        },
        createdAt: input.now
      });
    });
  }

  private async recordAuditEvent(input: {
    eventType: string;
    aggregateType?: string;
    aggregateId?: string;
    traceId: string;
    actor: AuditActor;
    metadata?: Record<string, unknown>;
    redactedPayload?: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void> {
    await this.audit.record({
      eventId: this.idGenerator.next('audit'),
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      traceId: input.traceId,
      actor: input.actor,
      metadata: input.metadata,
      redactedPayload:
        input.redactedPayload ??
        (input.metadata === undefined
          ? undefined
          : (this.redactionPolicy.redact(input.metadata) as Record<string, unknown>)),
      createdAt: input.createdAt,
      retentionUntil: this.retentionPolicy.calculateAuditRetentionUntil(input.createdAt)
    });
  }
}
