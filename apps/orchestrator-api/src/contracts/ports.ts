import type {
  AuditActor,
  LogRecord,
  ProcessingJobRequestedMessage,
  TelemetryEventSinkPort
} from '@document-parser/shared-kernel';
import type {
  AuditEventRecord,
  DeadLetterRecord,
  DocumentRecord,
  JobAttemptRecord,
  OperationalTelemetryRecord,
  PageArtifactRecord,
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
  delete(storageReference: StorageReference): Promise<void>;
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
  findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined>;
  save(result: ProcessingResultRecord): Promise<void>;
}

export interface PageArtifactRepositoryPort {
  saveMany(artifacts: PageArtifactRecord[]): Promise<void>;
  listByJobId(jobId: string): Promise<PageArtifactRecord[]>;
}

export interface DeadLetterRepositoryPort {
  save(record: DeadLetterRecord): Promise<void>;
  findById(dlqEventId: string): Promise<DeadLetterRecord | undefined>;
  list(): Promise<DeadLetterRecord[]>;
  listByJobId(jobId: string): Promise<DeadLetterRecord[]>;
  listByTraceId(traceId: string): Promise<DeadLetterRecord[]>;
}

export interface CompatibleResultLookupPort {
  findByCompatibilityKey(input: {
    hash: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
  }): Promise<ProcessingResultRecord | undefined>;
}

export interface UnitOfWorkPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export interface JobPublisherPort {
  publishRequested(message: ProcessingJobRequestedMessage): Promise<void>;
  publishRetry(message: ProcessingJobRequestedMessage, retryAttempt: number): Promise<void>;
}

export interface AuditPort {
  record(event: AuditEventRecord): Promise<void>;
  list(): Promise<AuditEventRecord[]>;
  listByJobId(jobId: string): Promise<AuditEventRecord[]>;
  listByTraceId(traceId: string): Promise<AuditEventRecord[]>;
}

export interface LoggingPort {
  log(entry: LogRecord): Promise<void>;
}

export interface MetricsPort {
  increment(input: {
    name: string;
    value?: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void>;
  recordHistogram(input: {
    name: string;
    value: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void>;
}

export interface TracingPort {
  runInSpan<T>(
    input: {
      traceId: string;
      spanName: string;
      attributes?: Record<string, unknown>;
    },
    work: () => Promise<T>
  ): Promise<T>;
}

export interface AuthorizationPort {
  ensureCanSubmit(actor: AuditActor): void;
  ensureCanRead(actor: AuditActor): void;
  ensureCanReprocess(actor: AuditActor): void;
}

export interface TelemetryEventRepositoryPort extends TelemetryEventSinkPort {
  listByJobId(jobId: string): Promise<OperationalTelemetryRecord[]>;
  listByTraceId(traceId: string): Promise<OperationalTelemetryRecord[]>;
  listByAttemptId(attemptId: string): Promise<OperationalTelemetryRecord[]>;
}
