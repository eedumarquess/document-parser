import type { ErrorCode, JobStatus } from '@document-parser/shared-kernel';

export type JobResponse = {
  jobId: string;
  documentId: string;
  status: JobStatus;
  requestedMode: string;
  pipelineVersion: string;
  outputVersion: string;
  reusedResult: boolean;
  createdAt: string;
};

export type ResultResponse = {
  jobId: string;
  documentId: string;
  status: JobStatus;
  requestedMode: string;
  pipelineVersion: string;
  outputVersion: string;
  confidence: number;
  warnings: string[];
  payload: string;
};

export type HttpErrorResponse = {
  errorCode: ErrorCode;
  message: string;
  metadata?: Record<string, unknown>;
};

export type JobOperationalSummaryResponse = {
  jobId: string;
  documentId: string;
  status: JobStatus;
  requestedMode: string;
  priority: string;
  queueName: string;
  pipelineVersion: string;
  outputVersion: string;
  reusedResult: boolean;
  forceReprocess: boolean;
  warnings: string[];
  errorCode?: string;
  errorMessage?: string;
  acceptedAt: string;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type JobAttemptOperationalResponse = {
  attemptId: string;
  attemptNumber: number;
  status: string;
  pipelineVersion: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  promptVersion?: string;
  modelVersion?: string;
  normalizationVersion?: string;
  latencyMs?: number;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
};

export type ProcessingResultOperationalResponse = ResultResponse & {
  engineUsed: string;
  totalLatencyMs: number;
  promptVersion?: string;
  modelVersion?: string;
  normalizationVersion?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditEventOperationalResponse = {
  eventId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  traceId: string;
  actor: {
    actorId: string;
    role: string;
  };
  metadata?: Record<string, unknown>;
  redactedPayload?: Record<string, unknown>;
  createdAt: string;
};

export type DeadLetterOperationalResponse = {
  dlqEventId: string;
  jobId?: string;
  attemptId?: string;
  traceId: string;
  queueName: string;
  reasonCode: string;
  reasonMessage: string;
  retryCount: number;
  payloadSnapshot?: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  replayedAt?: string;
};

export type ArtifactOperationalResponse = {
  artifactId: string;
  artifactType: string;
  pageNumber?: number;
  mimeType: string;
  storageBucket: string;
  storageObjectKey: string;
  metadata?: Record<string, unknown>;
  previewText?: string;
  createdAt: string;
  retentionUntil: string;
};

export type TelemetryEventOperationalResponse =
  | {
      telemetryEventId: string;
      kind: 'log';
      serviceName: string;
      traceId?: string;
      jobId?: string;
      documentId?: string;
      attemptId?: string;
      operation?: string;
      occurredAt: string;
      level: string;
      message: string;
      context: string;
      data?: Record<string, unknown>;
    }
  | {
      telemetryEventId: string;
      kind: 'metric';
      serviceName: string;
      traceId?: string;
      jobId?: string;
      documentId?: string;
      attemptId?: string;
      operation?: string;
      occurredAt: string;
      metricKind: 'counter' | 'histogram';
      name: string;
      value: number;
      tags?: Record<string, string>;
    }
  | {
      telemetryEventId: string;
      kind: 'span';
      serviceName: string;
      traceId?: string;
      jobId?: string;
      documentId?: string;
      attemptId?: string;
      operation?: string;
      occurredAt: string;
      spanName: string;
      attributes?: Record<string, unknown>;
      startedAt: string;
      endedAt: string;
      status: 'ok' | 'error';
      errorMessage?: string;
    };

export type JobTimelineItemResponse = {
  source: 'job' | 'attempt' | 'audit' | 'dead_letter' | 'telemetry' | 'result';
  occurredAt: string;
  title: string;
  detail: string;
  traceId?: string;
  attemptId?: string;
  serviceName?: string;
};

export type JobOperationalContextResponse = {
  summary: JobOperationalSummaryResponse;
  attempts: JobAttemptOperationalResponse[];
  result?: ProcessingResultOperationalResponse;
  auditEvents: AuditEventOperationalResponse[];
  deadLetters: DeadLetterOperationalResponse[];
  artifacts: ArtifactOperationalResponse[];
  telemetryEvents: TelemetryEventOperationalResponse[];
  traceIds: string[];
  timeline: JobTimelineItemResponse[];
};
