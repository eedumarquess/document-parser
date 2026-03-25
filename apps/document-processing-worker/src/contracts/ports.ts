import type { AuditActor, ProcessingJobRequestedMessage, ProcessingOutcome } from '@document-parser/shared-kernel';
import type {
  AuditEventRecord,
  DeadLetterRecord,
  DocumentRecord,
  JobAttemptRecord,
  PageArtifactRecord,
  ProcessingJobRecord,
  ProcessingResultRecord,
  StorageReference
} from './models';

export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  next(prefix: string): string;
}

export interface BinaryStoragePort {
  read(storageReference: StorageReference): Promise<Buffer>;
}

export interface DocumentRepositoryPort {
  findById(documentId: string): Promise<DocumentRecord | undefined>;
}

export interface ProcessingJobRepositoryPort {
  findById(jobId: string): Promise<ProcessingJobRecord | undefined>;
  save(job: ProcessingJobRecord): Promise<void>;
}

export interface JobAttemptRepositoryPort {
  findById(attemptId: string): Promise<JobAttemptRecord | undefined>;
  save(attempt: JobAttemptRecord): Promise<void>;
  listByJobId(jobId: string): Promise<JobAttemptRecord[]>;
}

export interface ProcessingResultRepositoryPort {
  save(result: ProcessingResultRecord): Promise<void>;
  findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined>;
}

export interface PageArtifactRepositoryPort {
  saveMany(artifacts: PageArtifactRecord[]): Promise<void>;
  listByJobId(jobId: string): Promise<PageArtifactRecord[]>;
}

export interface DeadLetterRepositoryPort {
  save(record: DeadLetterRecord): Promise<void>;
  list(): Promise<DeadLetterRecord[]>;
}

export interface AuditPort {
  record(event: AuditEventRecord): Promise<void>;
  list(): Promise<AuditEventRecord[]>;
}

export interface JobPublisherPort {
  publish(message: ProcessingJobRequestedMessage): Promise<void>;
}

export interface ExtractionPipelinePort {
  extract(input: {
    actor: AuditActor;
    document: DocumentRecord;
    job: ProcessingJobRecord;
    attempt: JobAttemptRecord;
    original: Buffer;
  }): Promise<ProcessingOutcome>;
}

