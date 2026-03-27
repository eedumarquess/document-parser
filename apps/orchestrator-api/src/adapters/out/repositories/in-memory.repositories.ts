import { Injectable } from '@nestjs/common';
import { JobStatus } from '@document-parser/shared-kernel';
import type {
  AuditPort,
  CompatibleResultLookupPort,
  DeadLetterRepositoryPort,
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  TelemetryEventRepositoryPort,
  UnitOfWorkPort
} from '../../../contracts/ports';
import type {
  AuditEventRecord,
  DeadLetterRecord,
  DocumentRecord,
  JobAttemptRecord,
  OperationalTelemetryRecord,
  PageArtifactRecord,
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
  private readonly resultsByJobId = new Map<string, ProcessingResultRecord>();
  private readonly jobIdByResultId = new Map<string, string>();

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

    return [...this.resultsByJobId.values()]
      .filter(
        (result) =>
          result.compatibilityKey === compatibilityKey &&
          (result.status === JobStatus.COMPLETED || result.status === JobStatus.PARTIAL)
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  }

  public async findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined> {
    return this.resultsByJobId.get(jobId);
  }

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
export class InMemoryUnitOfWork implements UnitOfWorkPort {
  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
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

  public async listByJobId(jobId: string): Promise<DeadLetterRecord[]> {
    return [...this.records.values()].filter((record) => record.jobId === jobId);
  }

  public async listByTraceId(traceId: string): Promise<DeadLetterRecord[]> {
    return [...this.records.values()].filter((record) => record.traceId === traceId);
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

  public async listByJobId(jobId: string): Promise<AuditEventRecord[]> {
    return this.events.filter(
      (event) => event.aggregateId === jobId || event.metadata?.jobId === jobId
    );
  }

  public async listByTraceId(traceId: string): Promise<AuditEventRecord[]> {
    return this.events.filter((event) => event.traceId === traceId);
  }
}

@Injectable()
export class InMemoryTelemetryEventRepository implements TelemetryEventRepositoryPort {
  private readonly events = new Map<string, OperationalTelemetryRecord>();

  public async save(event: OperationalTelemetryRecord): Promise<void> {
    this.events.set(event.telemetryEventId, event);
  }

  public async listByJobId(jobId: string): Promise<OperationalTelemetryRecord[]> {
    return [...this.events.values()].filter((event) => event.jobId === jobId);
  }

  public async listByTraceId(traceId: string): Promise<OperationalTelemetryRecord[]> {
    return [...this.events.values()].filter((event) => event.traceId === traceId);
  }

  public async listByAttemptId(attemptId: string): Promise<OperationalTelemetryRecord[]> {
    return [...this.events.values()].filter((event) => event.attemptId === attemptId);
  }
}
