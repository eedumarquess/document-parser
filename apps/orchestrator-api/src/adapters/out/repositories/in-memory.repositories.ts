import { Injectable } from '@nestjs/common';
import type {
  AuditPort,
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort
} from '../../../contracts/ports';
import type {
  AuditEventRecord,
  DocumentRecord,
  JobAttemptRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from '../../../contracts/models';

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
export class InMemoryProcessingResultRepository implements ProcessingResultRepositoryPort {
  private readonly results = new Map<string, ProcessingResultRecord>();

  public async findCompatibleResult(input: {
    documentId: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
  }): Promise<ProcessingResultRecord | undefined> {
    return [...this.results.values()].find(
      (result) =>
        result.documentId === input.documentId &&
        result.requestedMode === input.requestedMode &&
        result.pipelineVersion === input.pipelineVersion &&
        result.outputVersion === input.outputVersion
    );
  }

  public async findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined> {
    return [...this.results.values()].find((result) => result.jobId === jobId);
  }

  public async save(result: ProcessingResultRecord): Promise<void> {
    this.results.set(result.resultId, result);
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

