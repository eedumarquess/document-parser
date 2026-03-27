import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, RedactionPolicyService, type AuditActor } from '@document-parser/shared-kernel';
import type { ResultResponse } from '../../contracts/http';
import type {
  AuditPort,
  AuthorizationPort,
  ClockPort,
  IdGeneratorPort,
  LoggingPort,
  MetricsPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  TracingPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';
import type { GetProcessingResultQuery } from '../queries/get-processing-result.query';

@Injectable()
export class GetProcessingResultUseCase {
  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.RESULT_REPOSITORY) private readonly results: ProcessingResultRepositoryPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort,
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService
  ) {}

  public async execute(query: GetProcessingResultQuery, actor: AuditActor, traceId: string): Promise<ResultResponse> {
    const startedAt = Date.now();

    return this.tracing.runInSpan(
      {
        traceId,
        spanName: 'orchestrator.get_processing_result',
        attributes: {
          jobId: query.jobId,
          actorId: actor.actorId
        }
      },
      async () => {
        try {
          this.authorization.ensureCanRead(actor);
          const job = await this.jobs.findById(query.jobId);
          if (job === undefined) {
            throw new NotFoundError('Processing job not found', { jobId: query.jobId });
          }

          const result = await this.results.findByJobId(query.jobId);
          if (result === undefined) {
            throw new NotFoundError('Processing result not available yet', { jobId: query.jobId });
          }

          const now = this.clock.now();
          const metadata = {
            jobId: query.jobId,
            documentId: job.documentId,
            operation: 'get_processing_result'
          };

          await this.audit.record({
            eventId: this.idGenerator.next('audit'),
            eventType: 'RESULT_QUERIED',
            aggregateType: 'PROCESSING_JOB',
            aggregateId: job.jobId,
            traceId,
            actor,
            metadata: this.redactionPolicy.sanitizeMetadata(metadata, {
              context: 'audit'
            }) as Record<string, unknown>,
            redactedPayload: this.redactionPolicy.redact(
              {
                ...metadata,
                payload: result.payload,
                warnings: result.warnings
              },
              {
                context: 'audit'
              }
            ) as Record<string, unknown>,
            createdAt: now,
            retentionUntil: this.retentionPolicy.calculateAuditRetentionUntil(now)
          });
          await this.logging.log({
            level: 'info',
            message: 'Processing result queried',
            context: 'GetProcessingResultUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                ...metadata,
                status: result.status,
                warnings: result.warnings,
                payload: result.payload
              },
              {
                context: 'log'
              }
            ) as Record<string, unknown>,
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'orchestrator.processing_result.queried',
            traceId,
            tags: {
              jobId: query.jobId,
              documentId: job.documentId,
              operation: 'get_processing_result'
            }
          });

          return {
            jobId: result.jobId,
            documentId: result.documentId,
            status: result.status,
            requestedMode: result.requestedMode,
            pipelineVersion: result.pipelineVersion,
            outputVersion: result.outputVersion,
            confidence: result.confidence,
            warnings: result.warnings,
            payload: result.payload
          };
        } catch (error) {
          await this.metrics.increment({
            name: 'orchestrator.processing_result.failed',
            traceId,
            tags: {
              jobId: query.jobId,
              operation: 'get_processing_result'
            }
          });
          await this.logging.log({
            level: 'error',
            message: 'Processing result query failed',
            context: 'GetProcessingResultUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                jobId: query.jobId,
                actorId: actor.actorId,
                operation: 'get_processing_result',
                errorMessage: error instanceof Error ? error.message : 'Unexpected failure'
              },
              {
                context: 'log'
              }
            ) as Record<string, unknown>,
            recordedAt: this.clock.now()
          });
          throw error;
        } finally {
          await this.metrics.recordHistogram({
            name: 'orchestrator.processing_result.duration_ms',
            value: Date.now() - startedAt,
            traceId,
            tags: {
              jobId: query.jobId,
              operation: 'get_processing_result'
            }
          });
        }
      }
    );
  }
}
