import type { Collection } from 'mongodb';
import { JobStatus } from '@document-parser/shared-kernel';
import type {
  AuditEventRecord,
  DeadLetterRecord,
  DocumentRecord,
  IngestionTransitionRecord,
  JobAttemptRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from '../../../contracts/models';
import type {
  AuditPort,
  CompatibleResultLookupPort,
  DeadLetterRepositoryPort,
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort
} from '../../../contracts/ports';
import { CompatibilityKey } from '../../../domain/value-objects/compatibility-key';
import type { MongoDatabaseProvider, MongoSessionContext } from './mongodb.provider';

type MongoDocumentShape = {
  documentId: string;
  hash: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  pageCount: number;
  sourceType: 'MULTIPART';
  storageBucket: string;
  storageObjectKey: string;
  storageVersionId?: string;
  retentionUntil: Date;
  createdAt: Date;
  updatedAt: Date;
};

type MongoProcessingJobShape = Omit<ProcessingJobRecord, 'ingestionTransitions'> & {
  ingestionTransitions: IngestionTransitionRecord[];
};

type MongoJobAttemptShape = JobAttemptRecord;

type MongoProcessingResultShape = ProcessingResultRecord;

type MongoAuditEventShape = AuditEventRecord;

type MongoDeadLetterShape = DeadLetterRecord;

abstract class MongoRepositoryBase {
  public constructor(
    protected readonly provider: MongoDatabaseProvider,
    protected readonly sessionContext: MongoSessionContext
  ) {}

  protected getSession() {
    return this.sessionContext.getCurrentSession();
  }
}

export class MongoDocumentRepositoryAdapter
  extends MongoRepositoryBase
  implements DocumentRepositoryPort
{
  private indexesEnsured = false;

  public async findByHash(hash: string): Promise<DocumentRecord | undefined> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ hash }, { session: this.getSession() });
    return document === null ? undefined : fromMongoDocument(document);
  }

  public async findById(documentId: string): Promise<DocumentRecord | undefined> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ documentId }, { session: this.getSession() });
    return document === null ? undefined : fromMongoDocument(document);
  }

  public async save(document: DocumentRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { documentId: document.documentId },
      toMongoDocument(document),
      { upsert: true, session: this.getSession() }
    );
  }

  private async getCollection(): Promise<Collection<MongoDocumentShape>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<MongoDocumentShape>('documents');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { documentId: 1 }, unique: true },
        { key: { hash: 1 }, unique: true },
        { key: { createdAt: -1 } }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

export class MongoProcessingJobRepositoryAdapter
  extends MongoRepositoryBase
  implements ProcessingJobRepositoryPort
{
  private indexesEnsured = false;

  public async findById(jobId: string): Promise<ProcessingJobRecord | undefined> {
    const collection = await this.getCollection();
    const job = await collection.findOne({ jobId }, { session: this.getSession() });
    return job === null ? undefined : job;
  }

  public async save(job: ProcessingJobRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { jobId: job.jobId },
      job,
      { upsert: true, session: this.getSession() }
    );
  }

  public async list(): Promise<ProcessingJobRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({}, { session: this.getSession() })
      .sort({ acceptedAt: -1 })
      .toArray();
  }

  private async getCollection(): Promise<Collection<MongoProcessingJobShape>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<MongoProcessingJobShape>('processing_jobs');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { jobId: 1 }, unique: true },
        { key: { documentId: 1 } },
        { key: { status: 1 } },
        { key: { requestedMode: 1 } },
        { key: { pipelineVersion: 1 } },
        { key: { acceptedAt: -1 } }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

export class MongoJobAttemptRepositoryAdapter
  extends MongoRepositoryBase
  implements JobAttemptRepositoryPort
{
  private indexesEnsured = false;

  public async save(attempt: JobAttemptRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { attemptId: attempt.attemptId },
      attempt,
      { upsert: true, session: this.getSession() }
    );
  }

  public async findById(attemptId: string): Promise<JobAttemptRecord | undefined> {
    const collection = await this.getCollection();
    const attempt = await collection.findOne({ attemptId }, { session: this.getSession() });
    return attempt === null ? undefined : attempt;
  }

  public async listByJobId(jobId: string): Promise<JobAttemptRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({ jobId }, { session: this.getSession() })
      .sort({ attemptNumber: 1 })
      .toArray();
  }

  private async getCollection(): Promise<Collection<MongoJobAttemptShape>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<MongoJobAttemptShape>('job_attempts');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { attemptId: 1 }, unique: true },
        { key: { jobId: 1, attemptNumber: 1 }, unique: true },
        { key: { status: 1 } },
        { key: { pipelineVersion: 1 } }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

export class MongoProcessingResultRepositoryAdapter
  extends MongoRepositoryBase
  implements ProcessingResultRepositoryPort, CompatibleResultLookupPort
{
  private indexesEnsured = false;

  public async findByCompatibilityKey(input: {
    hash: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
  }): Promise<ProcessingResultRecord | undefined> {
    const collection = await this.getCollection();
    const compatibilityKey = CompatibilityKey.build(input);
    const result = await collection.findOne(
      {
        compatibilityKey,
        status: {
          $in: [JobStatus.COMPLETED, JobStatus.PARTIAL]
        }
      },
      {
        session: this.getSession(),
        sort: { createdAt: -1 }
      }
    );

    return result === null ? undefined : result;
  }

  public async findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined> {
    const collection = await this.getCollection();
    const result = await collection.findOne({ jobId }, { session: this.getSession() });
    return result === null ? undefined : result;
  }

  public async save(result: ProcessingResultRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { resultId: result.resultId },
      result,
      { upsert: true, session: this.getSession() }
    );
  }

  private async getCollection(): Promise<Collection<MongoProcessingResultShape>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<MongoProcessingResultShape>('processing_results');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { resultId: 1 }, unique: true },
        { key: { jobId: 1 } },
        { key: { compatibilityKey: 1, createdAt: -1 } },
        { key: { documentId: 1 } },
        { key: { status: 1 } },
        { key: { retentionUntil: 1 }, expireAfterSeconds: 0 }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

export class MongoDeadLetterRepositoryAdapter
  extends MongoRepositoryBase
  implements DeadLetterRepositoryPort
{
  private indexesEnsured = false;

  public async save(record: DeadLetterRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { dlqEventId: record.dlqEventId },
      record,
      { upsert: true, session: this.getSession() }
    );
  }

  public async findById(dlqEventId: string): Promise<DeadLetterRecord | undefined> {
    const collection = await this.getCollection();
    const record = await collection.findOne({ dlqEventId }, { session: this.getSession() });
    return record === null ? undefined : record;
  }

  public async list(): Promise<DeadLetterRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({}, { session: this.getSession() })
      .sort({ lastSeenAt: -1 })
      .toArray();
  }

  private async getCollection(): Promise<Collection<MongoDeadLetterShape>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<MongoDeadLetterShape>('dead_letter_events');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { dlqEventId: 1 }, unique: true },
        { key: { jobId: 1 } },
        { key: { reasonCode: 1 } },
        { key: { traceId: 1 } },
        { key: { retentionUntil: 1 }, expireAfterSeconds: 0 }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

export class MongoAuditRepositoryAdapter extends MongoRepositoryBase implements AuditPort {
  private indexesEnsured = false;

  public async record(event: AuditEventRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { eventId: event.eventId },
      event,
      { upsert: true, session: this.getSession() }
    );
  }

  public async list(): Promise<AuditEventRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({}, { session: this.getSession() })
      .sort({ createdAt: -1 })
      .toArray();
  }

  private async getCollection(): Promise<Collection<MongoAuditEventShape>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<MongoAuditEventShape>('audit_events');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { eventId: 1 }, unique: true },
        { key: { eventType: 1 } },
        { key: { aggregateType: 1, aggregateId: 1 } },
        { key: { traceId: 1 } },
        { key: { createdAt: -1 } },
        { key: { retentionUntil: 1 }, expireAfterSeconds: 0 }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

function toMongoDocument(document: DocumentRecord): MongoDocumentShape {
  return {
    documentId: document.documentId,
    hash: document.hash,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    pageCount: document.pageCount,
    sourceType: document.sourceType,
    storageBucket: document.storageReference.bucket,
    storageObjectKey: document.storageReference.objectKey,
    storageVersionId: document.storageReference.versionId,
    retentionUntil: document.retentionUntil,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

function fromMongoDocument(document: MongoDocumentShape): DocumentRecord {
  return {
    documentId: document.documentId,
    hash: document.hash,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    pageCount: document.pageCount,
    sourceType: document.sourceType,
    storageReference: {
      bucket: document.storageBucket,
      objectKey: document.storageObjectKey,
      versionId: document.storageVersionId
    },
    retentionUntil: document.retentionUntil,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}
