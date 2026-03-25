import type { JobWarning, AuditActor } from '@document-parser/shared-kernel';

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

export type UploadedFile = {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
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

export type PageArtifactRecord = {
  artifactId: string;
  artifactType: string;
  storageBucket: string;
  storageObjectKey: string;
  mimeType: string;
  pageNumber?: number;
  metadata?: Record<string, unknown>;
  documentId: string;
  jobId: string;
  createdAt: Date;
  warnings?: JobWarning[];
};
