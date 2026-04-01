import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type AuditActor } from '@document-parser/shared-kernel';
import type { JobResponse } from '../../contracts/http';
import type {
  AuditPort,
  AuthorizationPort,
  ClockPort,
  IdGeneratorPort,
  LoggingPort,
  MetricsPort,
  ProcessingJobRepositoryPort,
  TracingPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';
import { toJobResponse } from '../mappers/job-response.mapper';
import type { GetJobStatusQuery } from '../queries/get-job-status.query';
import { RedactionPolicyService } from '@document-parser/shared-kernel';

@Injectable()
export class GetJobStatusUseCase {
  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort,
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService
  ) {}

  public async execute(query: GetJobStatusQuery, actor: AuditActor, traceId: string): Promise<JobResponse> {
    const startedAt = Date.now();

    return this.tracing.runInSpan(
      {
        traceId,
        spanName: 'orchestrator.get_job_status',
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

          const now = this.clock.now();
          const metadata = {
            jobId: job.jobId,
            documentId: job.documentId,
            status: job.status,
            operation: 'get_job_status'
          };

          await this.audit.record({
            eventId: this.idGenerator.next('audit'),
            eventType: 'JOB_STATUS_QUERIED',
            aggregateType: 'PROCESSING_JOB',
            aggregateId: job.jobId,
            traceId,
            actor,
            metadata: this.redactionPolicy.sanitizeMetadata(metadata, {
              context: 'audit'
            }) as Record<string, unknown>,
            redactedPayload: this.redactionPolicy.redact(metadata, {
              context: 'audit'
            }) as Record<string, unknown>,
            createdAt: now,
            retentionUntil: this.retentionPolicy.calculateAuditRetentionUntil(now)
          });
          await this.logging.log({
            level: 'info',
            message: 'Job status queried',
            context: 'GetJobStatusUseCase',
            traceId,
            data: this.redactionPolicy.redact(metadata, {
              context: 'log'
            }) as Record<string, unknown>,
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'orchestrator.job_status.queried',
            traceId,
            tags: {
              jobId: job.jobId,
              documentId: job.documentId,
              operation: 'get_job_status'
            }
          });

          return toJobResponse(job);
        } catch (error) {
          await this.metrics.increment({
            name: 'orchestrator.job_status.failed',
            traceId,
            tags: {
              jobId: query.jobId,
              operation: 'get_job_status'
            }
          });
          await this.logging.log({
            level: 'error',
            message: 'Job status query failed',
            context: 'GetJobStatusUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                jobId: query.jobId,
                actorId: actor.actorId,
                operation: 'get_job_status',
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
            name: 'orchestrator.job_status.duration_ms',
            value: Date.now() - startedAt,
            traceId,
            tags: {
              jobId: query.jobId,
              operation: 'get_job_status'
            }
          });
        }
      }
    );
  }
}
