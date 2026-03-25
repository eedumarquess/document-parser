import { Injectable } from '@nestjs/common';
import { JobStatus } from '@document-parser/shared-kernel';
import type {
  AuditPort,
  CompatibleResultLookupPort,
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  UnitOfWorkPort
} from '../../../contracts/ports';
import type {
  AuditEventRecord,
  DocumentRecord,
  JobAttemptRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from '../../../contracts/models';
import { CompatibilityKey } from '../../../domain/value-objects/compatibility-key';

@Injectable()
export class InMemoryDocumentRepository implements DocumentRepositoryPort {
  private readonly documentsById = new Map<string, DocumentRecord>();
  private readonly documentsByHash = new Map<string, DocumentRecord>();

  public async findByHash(hash: string): Promise<DocumentRecord | undefined> {
    return this.documentsByHash.get(hash);
  }

  public async findById(documentId: string): Promise<DocumentRecord | undefined> {
    return this.documentsById.get(documentId);
  }

  public async save(document: DocumentRecord): Promise<void> {
    this.documentsById.set(document.documentId, document);
    this.documentsByHash.set(document.hash, document);
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

  public async list(): Promise<ProcessingJobRecord[]> {
    return [...this.jobs.values()];
  }
}

@Injectable()
export class InMemoryJobAttemptRepository implements JobAttemptRepositoryPort {
  private readonly attempts = new Map<string, JobAttemptRecord>();

  public async save(attempt: JobAttemptRecord): Promise<void> {
    this.attempts.set(attempt.attemptId, attempt);
  }

  public async findById(attemptId: string): Promise<JobAttemptRecord | undefined> {
    return this.attempts.get(attemptId);
  }

  public async listByJobId(jobId: string): Promise<JobAttemptRecord[]> {
    return [...this.attempts.values()].filter((attempt) => attempt.jobId === jobId);
  }
}

@Injectable()
export class InMemoryProcessingResultRepository
  implements ProcessingResultRepositoryPort, CompatibleResultLookupPort
{
  private readonly results = new Map<string, ProcessingResultRecord>();

  public async findByCompatibilityKey(input: {
    hash: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
  }): Promise<ProcessingResultRecord | undefined> {
    const compatibilityKey = CompatibilityKey.build({
      hash: input.hash,
      requestedMode: input.requestedMode,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion
    });

    return [...this.results.values()]
      .filter(
        (result) =>
          result.compatibilityKey === compatibilityKey &&
          (result.status === JobStatus.COMPLETED || result.status === JobStatus.PARTIAL)
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  }

  public async findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined> {
    return [...this.results.values()].find((result) => result.jobId === jobId);
  }

  public async save(result: ProcessingResultRecord): Promise<void> {
    this.results.set(result.resultId, result);
  }
}

@Injectable()
export class InMemoryUnitOfWork implements UnitOfWorkPort {
  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
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
