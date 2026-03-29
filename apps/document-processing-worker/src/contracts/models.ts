import type {
  ArtifactReference,
  AuditActor,
  QueuePublicationOutboxRecord
} from '@document-parser/shared-kernel';

export type {
  DeadLetterRecord,
  IngestionTransitionRecord,
  JobAttemptRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from '@document-parser/document-processing-domain';

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

export type AuditEventRecord = {
  eventId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  traceId: string;
  actor: AuditActor;
  metadata?: Record<string, unknown>;
  redactedPayload?: Record<string, unknown>;
  createdAt: Date;
  retentionUntil: Date;
};

export type PageArtifactRecord = ArtifactReference & {
  documentId: string;
  jobId: string;
  createdAt: Date;
  retentionUntil: Date;
};

export type { QueuePublicationOutboxRecord };
