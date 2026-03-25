import type {
  AttemptStatus,
  JobStatus,
  ArtifactReference,
  AuditActor,
  JobWarning
} from '@document-parser/shared-kernel';

export type IngestionTransitionRecord = {
  status:
    | JobStatus.RECEIVED
    | JobStatus.VALIDATED
    | JobStatus.STORED
    | JobStatus.DEDUPLICATED
    | JobStatus.REPROCESSED
    | JobStatus.QUEUED;
  at: Date;
};

export type StorageReference = {
  bucket: string;
  objectKey: string;
  versionId?: string;
};

export type DocumentRecord = {
  documentId: string;
  hash: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  pageCount: number;
  sourceType: 'MULTIPART';
  storageReference: StorageReference;
  retentionUntil: Date;
  createdAt: Date;
  updatedAt: Date;
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
  startedAt?: Date;
  finishedAt?: Date;
  latencyMs?: number;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
  createdAt: Date;
};

export type ProcessingResultRecord = {
  resultId: string;
  jobId: string;
  documentId: string;
  compatibilityKey: string;
  status: JobStatus.COMPLETED | JobStatus.PARTIAL | JobStatus.FAILED;
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
  createdAt: Date;
  updatedAt: Date;
};

export type AuditEventRecord = {
  eventId: string;
  eventType: string;
  actor: AuditActor;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export type DeadLetterRecord = {
  dlqEventId: string;
  jobId: string;
  attemptId: string;
  reasonCode: string;
  reasonMessage: string;
  retryCount: number;
  payloadSnapshot: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type PageArtifactRecord = ArtifactReference & {
  documentId: string;
  jobId: string;
  createdAt: Date;
};
