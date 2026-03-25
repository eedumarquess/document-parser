import type { AuditActor, ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
import type {
  AuditEventRecord,
  DocumentRecord,
  JobAttemptRecord,
  ProcessingJobRecord,
  ProcessingResultRecord,
  StorageReference,
  UploadedFile
} from './models';

export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  next(prefix: string): string;
}

export interface HashingPort {
  calculateHash(buffer: Buffer): Promise<string>;
}

export interface PageCounterPort {
  countPages(file: UploadedFile): Promise<number>;
}

export interface BinaryStoragePort {
  storeOriginal(input: {
    documentId: string;
    mimeType: string;
    originalName: string;
    buffer: Buffer;
  }): Promise<StorageReference>;
  read(storageReference: StorageReference): Promise<Buffer>;
}

export interface DocumentRepositoryPort {
  findByHash(hash: string): Promise<DocumentRecord | undefined>;
  findById(documentId: string): Promise<DocumentRecord | undefined>;
  save(document: DocumentRecord): Promise<void>;
}

export interface ProcessingJobRepositoryPort {
  findById(jobId: string): Promise<ProcessingJobRecord | undefined>;
  save(job: ProcessingJobRecord): Promise<void>;
  list(): Promise<ProcessingJobRecord[]>;
}

export interface JobAttemptRepositoryPort {
  save(attempt: JobAttemptRecord): Promise<void>;
  findById(attemptId: string): Promise<JobAttemptRecord | undefined>;
  listByJobId(jobId: string): Promise<JobAttemptRecord[]>;
}

export interface ProcessingResultRepositoryPort {
  findCompatibleResult(input: {
    documentId: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
  }): Promise<ProcessingResultRecord | undefined>;
  findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined>;
  save(result: ProcessingResultRecord): Promise<void>;
}

export interface JobPublisherPort {
  publish(message: ProcessingJobRequestedMessage): Promise<void>;
}

export interface AuditPort {
  record(event: AuditEventRecord): Promise<void>;
  list(): Promise<AuditEventRecord[]>;
}

export interface AuthorizationPort {
  ensureCanSubmit(actor: AuditActor): void;
  ensureCanRead(actor: AuditActor): void;
  ensureCanReprocess(actor: AuditActor): void;
}

