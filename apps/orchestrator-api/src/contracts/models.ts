import type {
  ArtifactReference,
  AuditEventRecord,
  JobWarning,
  QueuePublicationOutboxRecord,
  TelemetryEventRecord
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

export type PageArtifactRecord = ArtifactReference & {
  documentId: string;
  jobId: string;
  createdAt: Date;
  retentionUntil: Date;
  warnings?: JobWarning[];
};

export type OperationalTelemetryRecord = TelemetryEventRecord;

export type { AuditEventRecord, QueuePublicationOutboxRecord };
