import {
  QueuePublicationOutboxStatus,
  type AttemptStatus,
  type JobStatus,
  type QueuePublicationOutboxRecord,
  type TelemetryEventRecord
} from '@document-parser/shared-kernel';
import { Injectable } from '@nestjs/common';
import type {
  AuditPort,
  DeadLetterRepositoryPort,
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  QueuePublicationOutboxRepositoryPort,
  TelemetryEventRepositoryPort,
  UnitOfWorkPort
} from '../../../contracts/ports';
import type {
  AuditEventRecord,
  DeadLetterRecord,
  DocumentRecord,
  JobAttemptRecord,
  PageArtifactRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from '../../../contracts/models';

@Injectable()
export class InMemoryDocumentRepository implements DocumentRepositoryPort {
  private readonly documents = new Map<string, DocumentRecord>();

  public async findById(documentId: string): Promise<DocumentRecord | undefined> {
    return this.documents.get(documentId);
  }

  public async save(document: DocumentRecord): Promise<void> {
    this.documents.set(document.documentId, document);
  }
}

@Injectable()
export class InMemoryProcessingJobRepository implements ProcessingJobRepositoryPort {
  private readonly jobs = new Map<string, ProcessingJobRecord>();

  public async findById(jobId: string): Promise<ProcessingJobRecord | undefined> {
    return this.jobs.get(jobId);
  }

  public async save(job: ProcessingJobRecord): Promise<void> {
    this.jobs.set(job.jobId, job);
  }

  public async updateIfCurrentStatus(input: {
    jobId: string;
    currentStatuses: JobStatus[];
    job: ProcessingJobRecord;
  }): Promise<boolean> {
    const current = this.jobs.get(input.jobId);
    if (current === undefined || !input.currentStatuses.includes(current.status)) {
      return false;
    }

    this.jobs.set(input.jobId, input.job);
    return true;
  }
}

@Injectable()
export class InMemoryJobAttemptRepository implements JobAttemptRepositoryPort {
  private readonly attempts = new Map<string, JobAttemptRecord>();

  public async findById(attemptId: string): Promise<JobAttemptRecord | undefined> {
    return this.attempts.get(attemptId);
  }

  public async save(attempt: JobAttemptRecord): Promise<void> {
    this.attempts.set(attempt.attemptId, attempt);
  }

  public async updateIfCurrentStatus(input: {
    attemptId: string;
    currentStatuses: AttemptStatus[];
    attempt: JobAttemptRecord;
  }): Promise<boolean> {
    const current = this.attempts.get(input.attemptId);
    if (current === undefined || !input.currentStatuses.includes(current.status)) {
      return false;
    }

    this.attempts.set(input.attemptId, input.attempt);
    return true;
  }

  public async listByJobId(jobId: string): Promise<JobAttemptRecord[]> {
    return [...this.attempts.values()].filter((attempt) => attempt.jobId === jobId);
  }
}

@Injectable()
export class InMemoryProcessingResultRepository implements ProcessingResultRepositoryPort {
  private readonly resultsByJobId = new Map<string, ProcessingResultRecord>();
  private readonly jobIdByResultId = new Map<string, string>();

  public async save(result: ProcessingResultRecord): Promise<void> {
    const existingJobIdForResultId = this.jobIdByResultId.get(result.resultId);
    if (existingJobIdForResultId !== undefined && existingJobIdForResultId !== result.jobId) {
      this.resultsByJobId.delete(existingJobIdForResultId);
      this.jobIdByResultId.delete(result.resultId);
    }

    const existingResultForJob = this.resultsByJobId.get(result.jobId);
    if (existingResultForJob !== undefined && existingResultForJob.resultId !== result.resultId) {
      this.jobIdByResultId.delete(existingResultForJob.resultId);
    }

    this.resultsByJobId.set(result.jobId, result);
    this.jobIdByResultId.set(result.resultId, result.jobId);
  }

  public async findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined> {
    return this.resultsByJobId.get(jobId);
  }
}

@Injectable()
export class InMemoryPageArtifactRepository implements PageArtifactRepositoryPort {
  private readonly artifacts: PageArtifactRecord[] = [];

  public async saveMany(artifacts: PageArtifactRecord[]): Promise<void> {
    this.artifacts.push(...artifacts);
  }

  public async listByJobId(jobId: string): Promise<PageArtifactRecord[]> {
    return this.artifacts.filter((artifact) => artifact.jobId === jobId);
  }
}

@Injectable()
export class InMemoryDeadLetterRepository implements DeadLetterRepositoryPort {
  private readonly records = new Map<string, DeadLetterRecord>();

  public async save(record: DeadLetterRecord): Promise<void> {
    this.records.set(record.dlqEventId, record);
  }

  public async findById(dlqEventId: string): Promise<DeadLetterRecord | undefined> {
    return this.records.get(dlqEventId);
  }

  public async list(): Promise<DeadLetterRecord[]> {
    return [...this.records.values()];
  }
}

@Injectable()
export class InMemoryAuditRepository implements AuditPort {
  private readonly events: AuditEventRecord[] = [];

  public async record(event: AuditEventRecord): Promise<void> {
    this.events.push(event);
  }

  public async list(): Promise<AuditEventRecord[]> {
    return [...this.events];
  }
}

@Injectable()
export class InMemoryTelemetryEventRepository implements TelemetryEventRepositoryPort {
  private readonly events = new Map<string, TelemetryEventRecord>();

  public async save(event: TelemetryEventRecord): Promise<void> {
    this.events.set(event.telemetryEventId, event);
  }

  public async listByJobId(jobId: string): Promise<TelemetryEventRecord[]> {
    return [...this.events.values()].filter((event) => event.jobId === jobId);
  }

  public async listByTraceId(traceId: string): Promise<TelemetryEventRecord[]> {
    return [...this.events.values()].filter((event) => event.traceId === traceId);
  }

  public async listByAttemptId(attemptId: string): Promise<TelemetryEventRecord[]> {
    return [...this.events.values()].filter((event) => event.attemptId === attemptId);
  }
}

@Injectable()
export class InMemoryUnitOfWork implements UnitOfWorkPort {
  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

@Injectable()
export class InMemoryQueuePublicationOutboxRepository implements QueuePublicationOutboxRepositoryPort {
  private readonly records = new Map<string, QueuePublicationOutboxRecord>();

  public async save(record: QueuePublicationOutboxRecord): Promise<void> {
    this.records.set(record.outboxId, record);
  }

  public async findById(outboxId: string): Promise<QueuePublicationOutboxRecord | undefined> {
    return this.records.get(outboxId);
  }

  public async findLatestByJobId(jobId: string): Promise<QueuePublicationOutboxRecord | undefined> {
    return [...this.records.values()]
      .filter((record) => record.jobId === jobId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  }

  public async list(): Promise<QueuePublicationOutboxRecord[]> {
    return [...this.records.values()];
  }

  public async claimAvailable(input: {
    ownerService: string;
    now: Date;
    limit: number;
    leaseMs: number;
    leaseOwner: string;
  }): Promise<QueuePublicationOutboxRecord[]> {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const claimed: QueuePublicationOutboxRecord[] = [];

    for (const record of [...this.records.values()]
      .filter(
        (candidate) =>
          candidate.ownerService === input.ownerService &&
          candidate.status === QueuePublicationOutboxStatus.PENDING &&
          candidate.availableAt.getTime() <= input.now.getTime() &&
          (candidate.leaseExpiresAt === undefined || candidate.leaseExpiresAt.getTime() <= input.now.getTime())
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())) {
      if (claimed.length >= input.limit) {
        break;
      }

      const nextRecord = {
        ...record,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt,
        publishAttempts: record.publishAttempts + 1,
        updatedAt: input.now
      };
      this.records.set(record.outboxId, nextRecord);
      claimed.push(nextRecord);
    }

    return claimed;
  }
}
