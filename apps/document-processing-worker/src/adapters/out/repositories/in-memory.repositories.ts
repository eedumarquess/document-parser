import { Injectable } from '@nestjs/common';
import type {
  AuditPort,
  DeadLetterRepositoryPort,
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
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

  public async listByJobId(jobId: string): Promise<JobAttemptRecord[]> {
    return [...this.attempts.values()].filter((attempt) => attempt.jobId === jobId);
  }
}

@Injectable()
export class InMemoryProcessingResultRepository implements ProcessingResultRepositoryPort {
  private readonly results = new Map<string, ProcessingResultRecord>();

  public async save(result: ProcessingResultRecord): Promise<void> {
    this.results.set(result.resultId, result);
  }

  public async findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined> {
    return [...this.results.values()].find((result) => result.jobId === jobId);
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
  private readonly records: DeadLetterRecord[] = [];

  public async save(record: DeadLetterRecord): Promise<void> {
    this.records.push(record);
  }

  public async list(): Promise<DeadLetterRecord[]> {
    return [...this.records];
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
export class InMemoryUnitOfWork implements UnitOfWorkPort {
  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}
