import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  RedactionPolicyService,
  ValidationError,
  type AuditActor
} from '@document-parser/shared-kernel';
import type { JobResponse } from '../../contracts/http';
import type {
  AuthorizationPort,
  ClockPort,
  DeadLetterRepositoryPort,
  LoggingPort,
  MetricsPort,
  ProcessingJobRepositoryPort,
  TracingPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { AuditEventRecorder } from '../services/audit-event-recorder.service';
import { DerivedJobOrchestrator } from '../services/derived-job-orchestrator.service';
import type { ReplayDeadLetterCommand } from '../commands/replay-dead-letter.command';

@Injectable()
export class ReplayDeadLetterUseCase {
  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.DEAD_LETTER_REPOSITORY) private readonly deadLetters: DeadLetterRepositoryPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    private readonly redactionPolicy: RedactionPolicyService,
    private readonly auditEventRecorder: AuditEventRecorder,
    private readonly derivedJobOrchestrator: DerivedJobOrchestrator
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
          const derived = await this.derivedJobOrchestrator.execute({
            actor,
            originalJob,
            queueName: originalJob.queueName,
            traceId,
            now,
            onQueued: async ({ queuedJob, queuedAttempt }) => {
              await this.deadLetters.save({
                ...deadLetter,
                replayedAt: now
              });
              await this.auditEventRecorder.record({
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
              await this.auditEventRecorder.record({
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
            },
            publishFailure: {
              eventType: 'DEAD_LETTER_REPLAY_FAILED',
              failureMessage: 'Replay job persisted but queue publication failed',
              context: ({ job }) => ({
                dlqEventId: deadLetter.dlqEventId,
                jobId: job.jobId
              }),
              metadata: ({ job, errorMessage }) => ({
                dlqEventId: deadLetter.dlqEventId,
                jobId: job.jobId,
                errorMessage
              })
            }
          });

          await this.logging.log({
            level: 'info',
            message: 'Dead letter replay queued successfully',
            context: 'ReplayDeadLetterUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                dlqEventId: deadLetter.dlqEventId,
                jobId: derived.queuedJob.jobId,
                documentId: derived.queuedJob.documentId,
                sourceJobId: originalJob.jobId,
                operation: 'replay_dead_letter'
              },
              {
                context: 'log'
              }
            ),
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'orchestrator.dead_letter_replay.succeeded',
            traceId,
            tags: {
              jobId: derived.queuedJob.jobId,
              documentId: derived.queuedJob.documentId,
              attemptId: deadLetter.attemptId,
              operation: 'replay_dead_letter'
            }
          });

          return toJobResponse(derived.queuedJob);
        } catch (error) {
          await this.metrics.increment({
            name: 'orchestrator.dead_letter_replay.failed',
            traceId,
            tags: {
              operation: 'replay_dead_letter'
            }
          });
          await this.logging.log({
            level: 'error',
            message: 'Dead letter replay failed',
            context: 'ReplayDeadLetterUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                actorId: actor.actorId,
                dlqEventId: command.dlqEventId,
                operation: 'replay_dead_letter',
                errorMessage: error instanceof Error ? error.message : 'Unexpected failure'
              },
              {
                context: 'log'
              }
            ),
            recordedAt: this.clock.now()
          });
          throw error;
        } finally {
          await this.metrics.recordHistogram({
            name: 'orchestrator.dead_letter_replay.duration_ms',
            value: Date.now() - startedAt,
            traceId,
            tags: {
              operation: 'replay_dead_letter'
            }
          });
        }
      }
    );
  }
}

function toJobResponse(job: {
  jobId: string;
  documentId: string;
  status: JobResponse['status'];
  requestedMode: string;
  pipelineVersion: string;
  outputVersion: string;
  reusedResult: boolean;
  createdAt: Date;
}): JobResponse {
  return {
    jobId: job.jobId,
    documentId: job.documentId,
    status: job.status,
    requestedMode: job.requestedMode,
    pipelineVersion: job.pipelineVersion,
    outputVersion: job.outputVersion,
    reusedResult: job.reusedResult,
    createdAt: job.createdAt.toISOString()
  };
}
