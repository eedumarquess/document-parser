import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_PROCESSING_QUEUE_NAME } from '@document-parser/shared-kernel';
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
  LoggingPort,
  MetricsPort,
  ProcessingJobRepositoryPort,
  TracingPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { toJobResponse } from '../mappers/job-response.mapper';
import { AuditEventRecorder } from '../services/audit-event-recorder.service';
import { DerivedJobOrchestrator } from '../services/derived-job-orchestrator.service';
import type { ReprocessDocumentCommand } from '../commands/reprocess-document.command';

@Injectable()
export class ReprocessDocumentUseCase {
  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    private readonly redactionPolicy: RedactionPolicyService,
    private readonly auditEventRecorder: AuditEventRecorder,
    private readonly derivedJobOrchestrator: DerivedJobOrchestrator
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
          const derived = await this.derivedJobOrchestrator.execute({
            actor,
            originalJob,
            queueName: DEFAULT_PROCESSING_QUEUE_NAME,
            traceId,
            now,
            onStored: async ({ job }) => {
              await this.auditEventRecorder.record({
                eventType: 'JOB_REPROCESSING_REQUESTED',
                aggregateType: 'PROCESSING_JOB',
                aggregateId: job.jobId,
                traceId,
                actor,
                metadata: {
                  jobId: job.jobId,
                  reprocessOfJobId: originalJob.jobId,
                  reason: command.reason
                },
                createdAt: now
              });
            },
            queuedFinalizationMetadata: {
              actor,
              auditEventType: 'PROCESSING_JOB_QUEUED',
              auditAggregateType: 'PROCESSING_JOB',
              auditAggregateId: undefined,
              auditMetadata: {
                reprocessOfJobId: originalJob.jobId
              }
            },
          });

          await this.logging.log({
            level: 'info',
            message: 'Reprocessing job accepted for asynchronous queue publication',
            context: 'ReprocessDocumentUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                jobId: derived.job.jobId,
                documentId: derived.job.documentId,
                reprocessOfJobId: originalJob.jobId,
                operation: 'reprocess_document',
                status: derived.job.status
              },
              {
                context: 'log'
              }
            ),
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'orchestrator.queue_publication_outbox.enqueued',
            traceId,
            tags: {
              ownerService: 'orchestrator-api',
              flowType: 'reprocess',
              dispatchKind: 'publish_requested'
            }
          });
          await this.metrics.increment({
            name: 'orchestrator.reprocess_document.accepted',
            traceId,
            tags: {
              jobId: derived.job.jobId,
              documentId: derived.job.documentId,
              operation: 'reprocess_document'
            }
          });

          return toJobResponse(derived.job);
        } catch (error) {
          await this.metrics.increment({
            name: 'orchestrator.reprocess_document.failed',
            traceId,
            tags: {
              jobId: command.jobId,
              operation: 'reprocess_document'
            }
          });
          await this.logging.log({
            level: 'error',
            message: 'Reprocessing job failed',
            context: 'ReprocessDocumentUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                actorId: actor.actorId,
                jobId: command.jobId,
                operation: 'reprocess_document',
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
            name: 'orchestrator.reprocess_document.duration_ms',
            value: Date.now() - startedAt,
            traceId,
            tags: {
              jobId: command.jobId,
              operation: 'reprocess_document'
            }
          });
        }
      }
    );
  }
}
