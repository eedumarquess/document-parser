import type { ArtifactReference, AuditActor } from '@document-parser/shared-kernel';

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
  actor: AuditActor;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export type PageArtifactRecord = ArtifactReference & {
  documentId: string;
  jobId: string;
  createdAt: Date;
};
