import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  RedactionPolicyService,
  type AuditActor,
  type TelemetryEventRecord
} from '@document-parser/shared-kernel';
import type {
  ArtifactOperationalResponse,
  AuditEventOperationalResponse,
  DeadLetterOperationalResponse,
  JobAttemptOperationalResponse,
  JobOperationalContextResponse,
  JobTimelineItemResponse,
  ProcessingResultOperationalResponse,
  TelemetryEventOperationalResponse
} from '../../contracts/http';
import type {
  AuditPort,
  AuthorizationPort,
  ClockPort,
  DeadLetterRepositoryPort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  LoggingPort,
  MetricsPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  TelemetryEventRepositoryPort,
  TracingPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type {
  AuditEventRecord,
  DeadLetterRecord,
  JobAttemptRecord,
  PageArtifactRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from '../../contracts/models';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';
import { ArtifactPreviewService } from '../services/artifact-preview.service';
import type { GetJobOperationalContextQuery } from '../queries/get-job-operational-context.query';

@Injectable()
export class GetJobOperationalContextUseCase {
  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.RESULT_REPOSITORY) private readonly results: ProcessingResultRepositoryPort,
    @Inject(TOKENS.PAGE_ARTIFACT_REPOSITORY) private readonly artifacts: PageArtifactRepositoryPort,
    @Inject(TOKENS.DEAD_LETTER_REPOSITORY) private readonly deadLetters: DeadLetterRepositoryPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort,
    @Inject(TOKENS.TELEMETRY_REPOSITORY)
    private readonly telemetry: TelemetryEventRepositoryPort,
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService,
    private readonly artifactPreviewService: ArtifactPreviewService
  ) {}

  public async execute(
    query: GetJobOperationalContextQuery,
    actor: AuditActor,
    traceId: string
  ): Promise<JobOperationalContextResponse> {
    const startedAt = Date.now();

    return this.tracing.runInSpan(
      {
        traceId,
        spanName: 'orchestrator.get_job_operational_context',
        attributes: {
          actorId: actor.actorId,
          jobId: query.jobId,
          operation: 'get_job_operational_context'
        }
      },
      async () => {
        try {
          this.authorization.ensureCanRead(actor);

          const job = await this.jobs.findById(query.jobId);
          if (job === undefined) {
            throw new NotFoundError('Processing job not found', { jobId: query.jobId });
          }

          const [attempts, result, auditEvents, deadLetters, artifacts, jobTelemetry] = await Promise.all([
            this.attempts.listByJobId(query.jobId),
            this.results.findByJobId(query.jobId),
            this.audit.listByJobId(query.jobId),
            this.deadLetters.listByJobId(query.jobId),
            this.artifacts.listByJobId(query.jobId),
            this.telemetry.listByJobId(query.jobId)
          ]);

          const traceIds = collectTraceIds(auditEvents, deadLetters, jobTelemetry);
          const attemptIds = attempts.map((attempt) => attempt.attemptId);

          const [extraAuditEvents, extraDeadLetters, traceTelemetry, attemptTelemetry] = await Promise.all([
            Promise.all(traceIds.map((currentTraceId) => this.audit.listByTraceId(currentTraceId))),
            Promise.all(traceIds.map((currentTraceId) => this.deadLetters.listByTraceId(currentTraceId))),
            Promise.all(traceIds.map((currentTraceId) => this.telemetry.listByTraceId(currentTraceId))),
            Promise.all(attemptIds.map((attemptId) => this.telemetry.listByAttemptId(attemptId)))
          ]);

          const allAuditEvents = dedupeById(
            [...auditEvents, ...extraAuditEvents.flat()],
            (event) => event.eventId
          ).sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
          const allDeadLetters = dedupeById(
            [...deadLetters, ...extraDeadLetters.flat()],
            (record) => record.dlqEventId
          ).sort((left, right) => left.firstSeenAt.getTime() - right.firstSeenAt.getTime());
          const allTelemetryEvents = dedupeById(
            [...jobTelemetry, ...traceTelemetry.flat(), ...attemptTelemetry.flat()],
            (event) => event.telemetryEventId
          ).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
          const allTraceIds = [...new Set([
            ...traceIds,
            ...allTelemetryEvents.map((event) => event.traceId).filter((value): value is string => value !== undefined)
          ])].sort();

          const now = this.clock.now();
          const metadata = {
            jobId: job.jobId,
            documentId: job.documentId,
            operation: 'get_job_operational_context'
          };

          await this.audit.record({
            eventId: this.idGenerator.next('audit'),
            eventType: 'JOB_OPERATIONAL_CONTEXT_QUERIED',
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
            message: 'Operational context queried',
            context: 'GetJobOperationalContextUseCase',
            traceId,
            data: this.redactionPolicy.redact(metadata, {
              context: 'log'
            }) as Record<string, unknown>,
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'orchestrator.job_operational_context.queried',
            traceId,
            tags: {
              jobId: job.jobId,
              documentId: job.documentId,
              operation: 'get_job_operational_context'
            }
          });

          return {
            summary: toSummaryResponse(job),
            attempts: attempts.map(toAttemptResponse),
            result: result === undefined ? undefined : toOperationalResultResponse(result),
            auditEvents: allAuditEvents.map(toAuditResponse),
            deadLetters: allDeadLetters.map(toDeadLetterResponse),
            artifacts: artifacts.map((artifact) => this.artifactPreviewService.toResponse(artifact)),
            telemetryEvents: allTelemetryEvents.map(toTelemetryResponse),
            traceIds: allTraceIds,
            timeline: buildTimeline({
              job,
              attempts,
              result,
              auditEvents: allAuditEvents,
              deadLetters: allDeadLetters,
              telemetryEvents: allTelemetryEvents
            })
          };
        } catch (error) {
          await this.metrics.increment({
            name: 'orchestrator.job_operational_context.failed',
            traceId,
            tags: {
              jobId: query.jobId,
              operation: 'get_job_operational_context'
            }
          });
          await this.logging.log({
            level: 'error',
            message: 'Operational context query failed',
            context: 'GetJobOperationalContextUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                jobId: query.jobId,
                actorId: actor.actorId,
                operation: 'get_job_operational_context',
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
            name: 'orchestrator.job_operational_context.duration_ms',
            value: Date.now() - startedAt,
            traceId,
            tags: {
              jobId: query.jobId,
              operation: 'get_job_operational_context'
            }
          });
        }
      }
    );
  }
}

function toSummaryResponse(job: ProcessingJobRecord): JobOperationalContextResponse['summary'] {
  return {
    jobId: job.jobId,
    documentId: job.documentId,
    status: job.status,
    requestedMode: job.requestedMode,
    priority: job.priority,
    queueName: job.queueName,
    pipelineVersion: job.pipelineVersion,
    outputVersion: job.outputVersion,
    reusedResult: job.reusedResult,
    forceReprocess: job.forceReprocess,
    warnings: job.warnings,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    acceptedAt: job.acceptedAt.toISOString(),
    queuedAt: job.queuedAt?.toISOString(),
    startedAt: job.startedAt?.toISOString(),
    finishedAt: job.finishedAt?.toISOString(),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  };
}

function toAttemptResponse(attempt: JobAttemptRecord): JobAttemptOperationalResponse {
  return {
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    pipelineVersion: attempt.pipelineVersion,
    fallbackUsed: attempt.fallbackUsed,
    fallbackReason: attempt.fallbackReason,
    promptVersion: attempt.promptVersion,
    modelVersion: attempt.modelVersion,
    normalizationVersion: attempt.normalizationVersion,
    latencyMs: attempt.latencyMs,
    errorCode: attempt.errorCode,
    errorDetails: attempt.errorDetails,
    startedAt: attempt.startedAt?.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString(),
    createdAt: attempt.createdAt.toISOString()
  };
}

function toOperationalResultResponse(
  result: ProcessingResultRecord
): ProcessingResultOperationalResponse {
  return {
    jobId: result.jobId,
    documentId: result.documentId,
    status: result.status,
    requestedMode: result.requestedMode,
    pipelineVersion: result.pipelineVersion,
    outputVersion: result.outputVersion,
    confidence: result.confidence,
    warnings: result.warnings,
    payload: result.payload,
    engineUsed: result.engineUsed,
    totalLatencyMs: result.totalLatencyMs,
    promptVersion: result.promptVersion,
    modelVersion: result.modelVersion,
    normalizationVersion: result.normalizationVersion,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString()
  };
}

function toAuditResponse(event: AuditEventRecord): AuditEventOperationalResponse {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    traceId: event.traceId,
    actor: {
      actorId: event.actor.actorId,
      role: event.actor.role
    },
    metadata: event.metadata,
    redactedPayload: event.redactedPayload,
    createdAt: event.createdAt.toISOString()
  };
}

function toDeadLetterResponse(record: DeadLetterRecord): DeadLetterOperationalResponse {
  return {
    dlqEventId: record.dlqEventId,
    jobId: record.jobId,
    attemptId: record.attemptId,
    traceId: record.traceId,
    queueName: record.queueName,
    reasonCode: record.reasonCode,
    reasonMessage: record.reasonMessage,
    retryCount: record.retryCount,
    payloadSnapshot: record.payloadSnapshot,
    firstSeenAt: record.firstSeenAt.toISOString(),
    lastSeenAt: record.lastSeenAt.toISOString(),
    replayedAt: record.replayedAt?.toISOString()
  };
}

function toTelemetryResponse(event: TelemetryEventRecord): TelemetryEventOperationalResponse {
  if (event.kind === 'log') {
    return {
      telemetryEventId: event.telemetryEventId,
      kind: 'log',
      serviceName: event.serviceName,
      traceId: event.traceId,
      jobId: event.jobId,
      documentId: event.documentId,
      attemptId: event.attemptId,
      operation: event.operation,
      occurredAt: event.occurredAt.toISOString(),
      level: event.level,
      message: event.message,
      context: event.context,
      data: event.data
    };
  }

  if (event.kind === 'metric') {
    return {
      telemetryEventId: event.telemetryEventId,
      kind: 'metric',
      serviceName: event.serviceName,
      traceId: event.traceId,
      jobId: event.jobId,
      documentId: event.documentId,
      attemptId: event.attemptId,
      operation: event.operation,
      occurredAt: event.occurredAt.toISOString(),
      metricKind: event.metricKind,
      name: event.name,
      value: event.value,
      tags: event.tags
    };
  }

  return {
    telemetryEventId: event.telemetryEventId,
    kind: 'span',
    serviceName: event.serviceName,
    traceId: event.traceId,
    jobId: event.jobId,
    documentId: event.documentId,
    attemptId: event.attemptId,
    operation: event.operation,
    occurredAt: event.occurredAt.toISOString(),
    spanName: event.spanName,
    attributes: event.attributes,
    startedAt: event.startedAt.toISOString(),
    endedAt: event.endedAt.toISOString(),
    status: event.status,
    errorMessage: event.errorMessage
  };
}

function buildTimeline(input: {
  job: ProcessingJobRecord;
  attempts: JobAttemptRecord[];
  result?: ProcessingResultRecord;
  auditEvents: AuditEventRecord[];
  deadLetters: DeadLetterRecord[];
  telemetryEvents: TelemetryEventRecord[];
}): JobTimelineItemResponse[] {
  const items: JobTimelineItemResponse[] = [
    ...input.job.ingestionTransitions.map((transition) => ({
      source: 'job' as const,
      occurredAt: transition.at.toISOString(),
      title: `Job ${transition.status}`,
      detail: `Transitioned to ${transition.status}`
    })),
    ...input.attempts.map((attempt) => ({
      source: 'attempt' as const,
      occurredAt: (attempt.finishedAt ?? attempt.startedAt ?? attempt.createdAt).toISOString(),
      title: `Attempt ${attempt.attemptNumber} ${attempt.status}`,
      detail: `Attempt ${attempt.attemptId}`,
      attemptId: attempt.attemptId
    })),
    ...(input.result === undefined
      ? []
      : [
          {
            source: 'result' as const,
            occurredAt: input.result.createdAt.toISOString(),
            title: `Result ${input.result.status}`,
            detail: `Engine ${input.result.engineUsed} with confidence ${input.result.confidence.toFixed(2)}`
          }
        ]),
    ...input.auditEvents.map((event) => ({
      source: 'audit' as const,
      occurredAt: event.createdAt.toISOString(),
      title: event.eventType,
      detail: event.aggregateId ?? event.aggregateType ?? 'audit_event',
      traceId: event.traceId
    })),
    ...input.deadLetters.map((record) => ({
      source: 'dead_letter' as const,
      occurredAt: record.lastSeenAt.toISOString(),
      title: `DLQ ${record.reasonCode}`,
      detail: record.reasonMessage,
      traceId: record.traceId,
      attemptId: record.attemptId
    })),
    ...input.telemetryEvents.map((event) => ({
      source: 'telemetry' as const,
      occurredAt: event.occurredAt.toISOString(),
      title:
        event.kind === 'log'
          ? `${event.serviceName} log`
          : event.kind === 'metric'
            ? `${event.serviceName} metric`
            : `${event.serviceName} span`,
      detail:
        event.kind === 'log'
          ? `${event.level}: ${event.message}`
          : event.kind === 'metric'
            ? `${event.name}=${event.value}`
            : `${event.spanName} (${event.status})`,
      traceId: event.traceId,
      attemptId: event.attemptId,
      serviceName: event.serviceName
    }))
  ];

  return items.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
}

function collectTraceIds(
  auditEvents: AuditEventRecord[],
  deadLetters: DeadLetterRecord[],
  telemetryEvents: TelemetryEventRecord[]
): string[] {
  return [...new Set([
    ...auditEvents.map((event) => event.traceId),
    ...deadLetters.map((record) => record.traceId),
    ...telemetryEvents.map((event) => event.traceId).filter((value): value is string => value !== undefined)
  ])].sort();
}

function dedupeById<T>(items: T[], selectId: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [selectId(item), item] as const)).values()];
}
