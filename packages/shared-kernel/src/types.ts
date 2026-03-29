import type { AttemptStatus, JobStatus, QueuePublicationOutboxStatus, Role } from './enums';
import type { ExtractionWarning, FallbackReason } from './constants';

export type VersionStamp = {
  pipelineVersion: string;
  outputVersion: string;
  normalizationVersion?: string;
  promptVersion?: string;
  modelVersion?: string;
};

export type AuditActor = {
  actorId: string;
  role: Role;
};

export type ProcessingJobRequestedMessage = {
  documentId: string;
  jobId: string;
  attemptId: string;
  traceId: string;
  requestedMode: string;
  pipelineVersion: string;
  publishedAt: string;
};

export type QueuePublicationMessageBase = Omit<ProcessingJobRequestedMessage, 'publishedAt'>;

export type QueuePublicationFlowType = 'submission' | 'reprocess' | 'replay' | 'retry';

export type QueuePublicationDispatchKind = 'publish_requested' | 'publish_retry';

export type QueuePublicationOutboxRecord = {
  outboxId: string;
  ownerService: string;
  flowType: QueuePublicationFlowType;
  dispatchKind: QueuePublicationDispatchKind;
  retryAttempt?: number;
  jobId: string;
  documentId: string;
  attemptId: string;
  queueName: string;
  messageBase: QueuePublicationMessageBase;
  finalizationMetadata?: Record<string, unknown>;
  status: QueuePublicationOutboxStatus;
  publishAttempts: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  lastError?: string;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  retentionUntil?: Date;
};

export type JobWarning = ExtractionWarning;

export type ArtifactReference = {
  artifactId: string;
  artifactType: string;
  storageBucket: string;
  storageObjectKey: string;
  mimeType: string;
  pageNumber?: number;
  metadata?: Record<string, unknown>;
};

export type ProcessingOutcome = {
  status: JobStatus.COMPLETED | JobStatus.PARTIAL;
  engineUsed: string;
  confidence: number;
  warnings: JobWarning[];
  payload: string;
  artifacts: ArtifactReference[];
  fallbackUsed: boolean;
  fallbackReason?: FallbackReason;
  promptVersion?: string;
  modelVersion?: string;
  normalizationVersion?: string;
  totalLatencyMs: number;
  attemptStatus?: AttemptStatus;
};
