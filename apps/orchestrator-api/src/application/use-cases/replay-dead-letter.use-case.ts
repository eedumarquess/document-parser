import { Inject, Injectable } from '@nestjs/common';
import {
  VersionStampService,
  createPendingAttempt,
  createReprocessingJob,
  markAttemptAsQueued,
  markJobAsQueued,
  markJobAsStored,
  markJobAsValidated,
  recordJobError
} from '@document-parser/document-processing-domain';
import {
  ErrorCode,
  NotFoundError,
  RedactionPolicyService,
  TransientFailureError,
  ValidationError,
  type AuditActor,
  type ProcessingJobRequestedMessage
} from '@document-parser/shared-kernel';
import type { JobResponse } from '../../contracts/http';
import type { DeadLetterRecord, ProcessingJobRecord } from '../../contracts/models';
import type {
  AuditPort,
  AuthorizationPort,
  ClockPort,
  DeadLetterRepositoryPort,
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
import type { ReplayDeadLetterCommand } from '../commands/replay-dead-letter.command';

@Injectable()
export class ReplayDeadLetterUseCase {
  private readonly versionStamps = new VersionStampService();

  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.DEAD_LETTER_REPOSITORY) private readonly deadLetters: DeadLetterRepositoryPort,
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

  public async execute(command: ReplayDeadLetterCommand, actor: AuditActor, traceId: string): Promise<JobResponse> {
    const startedAt = Date.now();

    return this.tracing.runInSpan(
      {
        traceId,
        spanName: 'orchestrator.replay_dead_letter',
        attributes: {
          actorId: actor.actorId,
          dlqEventId: command.dlqEventId
        }
      },
      async () => {
        try {
          this.authorization.ensureCanReprocess(actor);
          if (command.reason.trim() === '') {
            throw new ValidationError('Replay reason is required');
          }

          const deadLetter = await this.deadLetters.findById(command.dlqEventId);
          if (deadLetter === undefined) {
            throw new NotFoundError('Dead letter event not found', { dlqEventId: command.dlqEventId });
          }
          if (deadLetter.replayedAt !== undefined) {
            throw new ValidationError('Dead letter event has already been replayed', {
              dlqEventId: command.dlqEventId
            });
          }

          const originalJob = await this.jobs.findById(deadLetter.jobId);
          if (originalJob === undefined) {
            throw new NotFoundError('Processing job not found', { jobId: deadLetter.jobId });
          }

          const now = this.clock.now();
          const { pipelineVersion, outputVersion } = this.versionStamps.buildJobStamp({
            pipelineVersion: originalJob.pipelineVersion,
            outputVersion: originalJob.outputVersion
          });
          const replayJob = markJobAsStored({
            job: markJobAsValidated({
              job: createReprocessingJob({
                jobId: this.idGenerator.next('job'),
                documentId: originalJob.documentId,
                requestedMode: originalJob.requestedMode,
                queueName: originalJob.queueName,
                pipelineVersion,
                outputVersion,
                requestedBy: actor,
                reprocessOfJobId: originalJob.jobId,
                now
              }),
              now
            }),
            now
          });
          const attempt = createPendingAttempt({
            attemptId: this.idGenerator.next('attempt'),
            jobId: replayJob.jobId,
            attemptNumber: 1,
            pipelineVersion: replayJob.pipelineVersion,
            now
          });

          await this.unitOfWork.runInTransaction(async () => {
            await this.jobs.save(replayJob);
            await this.attempts.save(attempt);
          });

          const message: ProcessingJobRequestedMessage = {
            documentId: replayJob.documentId,
            jobId: replayJob.jobId,
            attemptId: attempt.attemptId,
            traceId,
            requestedMode: replayJob.requestedMode,
            pipelineVersion: replayJob.pipelineVersion,
            publishedAt: now.toISOString()
          };

          try {
            await this.publisher.publishRequested(message);
          } catch (error) {
            await this.handleReplayPublishFailure({
              actor,
              traceId,
              deadLetter,
              replayJob,
              now,
              errorMessage: error instanceof Error ? error.message : 'Unexpected queue publishing failure'
            });
            throw new TransientFailureError('Replay job persisted but queue publication failed', {
              dlqEventId: deadLetter.dlqEventId,
              jobId: replayJob.jobId
            });
          }

          const queuedJob = markJobAsQueued({
            job: replayJob,
            now
          });
          const queuedAttempt = markAttemptAsQueued({
            attempt
          });
          const replayedDeadLetter: DeadLetterRecord = {
            ...deadLetter,
            replayedAt: now
          };

          await this.unitOfWork.runInTransaction(async () => {
            await this.jobs.save(queuedJob);
            await this.attempts.save(queuedAttempt);
            await this.deadLetters.save(replayedDeadLetter);
            await this.recordAuditEvent({
              eventType: 'PROCESSING_JOB_QUEUED',
              aggregateType: 'PROCESSING_JOB',
              aggregateId: queuedJob.jobId,
              traceId,
              actor,
              metadata: {
                jobId: queuedJob.jobId,
                attemptId: queuedAttempt.attemptId,
                reprocessOfJobId: originalJob.jobId
              },
              createdAt: now
            });
            await this.recordAuditEvent({
              eventType: 'DEAD_LETTER_REPLAY_REQUESTED',
              aggregateType: 'PROCESSING_JOB',
              aggregateId: queuedJob.jobId,
              traceId,
              actor,
              metadata: {
                dlqEventId: deadLetter.dlqEventId,
                jobId: queuedJob.jobId,
                sourceJobId: originalJob.jobId,
                reason: command.reason
              },
              createdAt: now
            });
          });

          await this.logging.log({
            level: 'info',
            message: 'Dead letter replay queued successfully',
            context: 'ReplayDeadLetterUseCase',
            traceId,
            data: this.redactionPolicy.redact({
              dlqEventId: deadLetter.dlqEventId,
              jobId: queuedJob.jobId,
              sourceJobId: originalJob.jobId
            }) as Record<string, unknown>,
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'orchestrator.dead_letter_replay.succeeded',
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
            name: 'orchestrator.dead_letter_replay.failed',
            traceId
          });
          await this.logging.log({
            level: 'error',
            message: 'Dead letter replay failed',
            context: 'ReplayDeadLetterUseCase',
            traceId,
            data: this.redactionPolicy.redact({
              actorId: actor.actorId,
              dlqEventId: command.dlqEventId,
              errorMessage: error instanceof Error ? error.message : 'Unexpected failure'
            }) as Record<string, unknown>,
            recordedAt: this.clock.now()
          });
          throw error;
        } finally {
          await this.metrics.recordHistogram({
            name: 'orchestrator.dead_letter_replay.duration_ms',
            value: Date.now() - startedAt,
            traceId
          });
        }
      }
    );
  }

  private async handleReplayPublishFailure(input: {
    actor: AuditActor;
    traceId: string;
    deadLetter: DeadLetterRecord;
    replayJob: ProcessingJobRecord;
    now: Date;
    errorMessage: string;
  }): Promise<void> {
    const failedJob = recordJobError({
      job: input.replayJob,
      errorCode: ErrorCode.TRANSIENT_FAILURE,
      errorMessage: input.errorMessage,
      now: input.now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(failedJob);
      await this.recordAuditEvent({
        eventType: 'DEAD_LETTER_REPLAY_FAILED',
        aggregateType: 'PROCESSING_JOB',
        aggregateId: input.replayJob.jobId,
        traceId: input.traceId,
        actor: input.actor,
        metadata: {
          dlqEventId: input.deadLetter.dlqEventId,
          jobId: input.replayJob.jobId,
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
