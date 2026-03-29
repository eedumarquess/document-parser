import type {
  AttemptStatus,
  AuditActor,
  JobStatus,
  LogRecord,
  ProcessingJobRequestedMessage,
  ProcessingOutcome,
  QueuePublicationOutboxRecord,
  TelemetryEventRecord,
  TelemetryEventSinkPort
} from '@document-parser/shared-kernel';
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
  updateIfCurrentStatus(input: {
    jobId: string;
    currentStatuses: JobStatus[];
    job: ProcessingJobRecord;
  }): Promise<boolean>;
}

export interface JobAttemptRepositoryPort {
  findById(attemptId: string): Promise<JobAttemptRecord | undefined>;
  save(attempt: JobAttemptRecord): Promise<void>;
  updateIfCurrentStatus(input: {
    attemptId: string;
    currentStatuses: AttemptStatus[];
    attempt: JobAttemptRecord;
  }): Promise<boolean>;
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
  findById(dlqEventId: string): Promise<DeadLetterRecord | undefined>;
  list(): Promise<DeadLetterRecord[]>;
}

export interface AuditPort {
  record(event: AuditEventRecord): Promise<void>;
  list(): Promise<AuditEventRecord[]>;
}

export interface TelemetryEventRepositoryPort extends TelemetryEventSinkPort {
  listByJobId(jobId: string): Promise<TelemetryEventRecord[]>;
  listByTraceId(traceId: string): Promise<TelemetryEventRecord[]>;
  listByAttemptId(attemptId: string): Promise<TelemetryEventRecord[]>;
}

export interface JobPublisherPort {
  publishRequested(message: ProcessingJobRequestedMessage): Promise<void>;
  publishRetry(message: ProcessingJobRequestedMessage, retryAttempt: number): Promise<void>;
}

export interface QueuePublicationOutboxRepositoryPort {
  save(record: QueuePublicationOutboxRecord): Promise<void>;
  findById(outboxId: string): Promise<QueuePublicationOutboxRecord | undefined>;
  findLatestByJobId(jobId: string): Promise<QueuePublicationOutboxRecord | undefined>;
  list(): Promise<QueuePublicationOutboxRecord[]>;
  claimAvailable(input: {
    ownerService: string;
    now: Date;
    limit: number;
    leaseMs: number;
    leaseOwner: string;
  }): Promise<QueuePublicationOutboxRecord[]>;
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

export interface UnitOfWorkPort {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export interface ExtractionPipelinePort {
  extract(input: {
    actor: AuditActor;
    traceId: string;
    document: DocumentRecord;
    job: ProcessingJobRecord;
    attempt: JobAttemptRecord;
    original: Buffer;
  }): Promise<ProcessingOutcome>;
}
