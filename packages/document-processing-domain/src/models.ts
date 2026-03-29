import type {
  AttemptStatus,
  JobStatus,
  AuditActor,
  FallbackReason,
  JobWarning
} from '@document-parser/shared-kernel';

export type IngestionTransitionRecord = {
  status:
    | JobStatus.RECEIVED
    | JobStatus.VALIDATED
    | JobStatus.STORED
    | JobStatus.PUBLISH_PENDING
    | JobStatus.DEDUPLICATED
    | JobStatus.REPROCESSED
    | JobStatus.QUEUED;
  at: Date;
};

export type ProcessingJobRecord = {
  jobId: string;
  documentId: string;
  requestedMode: string;
  priority: string;
  queueName: string;
  status: JobStatus;
  forceReprocess: boolean;
  reusedResult: boolean;
  sourceJobId?: string;
  sourceResultId?: string;
  reprocessOfJobId?: string;
  pipelineVersion: string;
  outputVersion: string;
  acceptedAt: Date;
  queuedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  requestedBy: AuditActor;
  warnings: JobWarning[];
  errorCode?: string;
  errorMessage?: string;
  ingestionTransitions: IngestionTransitionRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type JobAttemptRecord = {
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  pipelineVersion: string;
  status: AttemptStatus;
  fallbackUsed: boolean;
  fallbackReason?: FallbackReason;
  startedAt?: Date;
  finishedAt?: Date;
  latencyMs?: number;
  normalizationVersion?: string;
  promptVersion?: string;
  modelVersion?: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
  createdAt: Date;
};

export type ProcessingResultRecord = {
  resultId: string;
  jobId: string;
  documentId: string;
  compatibilityKey: string;
  status: JobStatus.COMPLETED | JobStatus.PARTIAL;
  requestedMode: string;
  pipelineVersion: string;
  outputVersion: string;
  confidence: number;
  warnings: JobWarning[];
  payload: string;
  engineUsed: string;
  totalLatencyMs: number;
  promptVersion?: string;
  modelVersion?: string;
  normalizationVersion?: string;
  sourceJobId?: string;
  createdAt: Date;
  updatedAt: Date;
  retentionUntil: Date;
};

export type DeadLetterRecord = {
  dlqEventId: string;
  jobId: string;
  attemptId: string;
  traceId: string;
  queueName: string;
  reasonCode: string;
  reasonMessage: string;
  retryCount: number;
  payloadSnapshot: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  replayedAt?: Date;
  retentionUntil: Date;
};
