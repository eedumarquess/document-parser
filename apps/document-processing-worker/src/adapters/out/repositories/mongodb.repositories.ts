import type { Collection } from 'mongodb';
import type {
  AuditEventRecord,
  DeadLetterRecord,
  DocumentRecord,
  JobAttemptRecord,
  PageArtifactRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from '../../../contracts/models';
import type {
  AuditPort,
  DeadLetterRepositoryPort,
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort
} from '../../../contracts/ports';
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
        { key: { hash: 1 }, unique: true }
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

  private async getCollection(): Promise<Collection<ProcessingJobRecord>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<ProcessingJobRecord>('processing_jobs');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { jobId: 1 }, unique: true },
        { key: { documentId: 1 } },
        { key: { status: 1 } }
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

  public async findById(attemptId: string): Promise<JobAttemptRecord | undefined> {
    const collection = await this.getCollection();
    const attempt = await collection.findOne({ attemptId }, { session: this.getSession() });
    return attempt === null ? undefined : attempt;
  }

  public async save(attempt: JobAttemptRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { attemptId: attempt.attemptId },
      attempt,
      { upsert: true, session: this.getSession() }
    );
  }

  public async listByJobId(jobId: string): Promise<JobAttemptRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({ jobId }, { session: this.getSession() })
      .sort({ attemptNumber: 1 })
      .toArray();
  }

  private async getCollection(): Promise<Collection<JobAttemptRecord>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<JobAttemptRecord>('job_attempts');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { attemptId: 1 }, unique: true },
        { key: { jobId: 1, attemptNumber: 1 }, unique: true }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

export class MongoProcessingResultRepositoryAdapter
  extends MongoRepositoryBase
  implements ProcessingResultRepositoryPort
{
  private indexesEnsured = false;

  public async save(result: ProcessingResultRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { resultId: result.resultId },
      result,
      { upsert: true, session: this.getSession() }
    );
  }

  public async findByJobId(jobId: string): Promise<ProcessingResultRecord | undefined> {
    const collection = await this.getCollection();
    const result = await collection.findOne({ jobId }, { session: this.getSession() });
    return result === null ? undefined : result;
  }

  private async getCollection(): Promise<Collection<ProcessingResultRecord>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<ProcessingResultRecord>('processing_results');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { resultId: 1 }, unique: true },
        { key: { jobId: 1 } },
        { key: { compatibilityKey: 1, createdAt: -1 } },
        { key: { retentionUntil: 1 }, expireAfterSeconds: 0 }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

export class MongoPageArtifactRepositoryAdapter
  extends MongoRepositoryBase
  implements PageArtifactRepositoryPort
{
  private indexesEnsured = false;

  public async saveMany(artifacts: PageArtifactRecord[]): Promise<void> {
    if (artifacts.length === 0) {
      return;
    }

    const collection = await this.getCollection();
    await collection.bulkWrite(
      artifacts.map((artifact) => ({
        replaceOne: {
          filter: { artifactId: artifact.artifactId },
          replacement: artifact,
          upsert: true
        }
      })),
      { session: this.getSession() }
    );
  }

  public async listByJobId(jobId: string): Promise<PageArtifactRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({ jobId }, { session: this.getSession() })
      .sort({ pageNumber: 1 })
      .toArray();
  }

  private async getCollection(): Promise<Collection<PageArtifactRecord>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<PageArtifactRecord>('page_artifacts');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { artifactId: 1 }, unique: true },
        { key: { documentId: 1 } },
        { key: { jobId: 1 } },
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

  public async list(): Promise<DeadLetterRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({}, { session: this.getSession() })
      .sort({ lastSeenAt: -1 })
      .toArray();
  }

  public async findById(dlqEventId: string): Promise<DeadLetterRecord | undefined> {
    const collection = await this.getCollection();
    const record = await collection.findOne({ dlqEventId }, { session: this.getSession() });
    return record === null ? undefined : record;
  }

  private async getCollection(): Promise<Collection<DeadLetterRecord>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<DeadLetterRecord>('dead_letter_events');
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

  private async getCollection(): Promise<Collection<AuditEventRecord>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<AuditEventRecord>('audit_events');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { eventId: 1 }, unique: true },
        { key: { eventType: 1 } },
        { key: { aggregateType: 1, aggregateId: 1 } },
        { key: { traceId: 1 } },
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
