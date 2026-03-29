import type { Collection } from 'mongodb';
import type {
  AttemptStatus,
  JobStatus,
  QueuePublicationOutboxRecord,
  TelemetryEventRecord
} from '@document-parser/shared-kernel';
import { QueuePublicationOutboxStatus } from '@document-parser/shared-kernel';
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
  ProcessingResultRepositoryPort,
  QueuePublicationOutboxRepositoryPort,
  TelemetryEventRepositoryPort
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

type MongoQueuePublicationOutboxShape = QueuePublicationOutboxRecord;

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

  public async updateIfCurrentStatus(input: {
    jobId: string;
    currentStatuses: JobStatus[];
    job: ProcessingJobRecord;
  }): Promise<boolean> {
    const collection = await this.getCollection();
    const result = await collection.replaceOne(
      {
        jobId: input.jobId,
        status: { $in: input.currentStatuses }
      },
      input.job,
      { session: this.getSession() }
    );

    return result.matchedCount === 1;
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

  public async updateIfCurrentStatus(input: {
    attemptId: string;
    currentStatuses: AttemptStatus[];
    attempt: JobAttemptRecord;
  }): Promise<boolean> {
    const collection = await this.getCollection();
    const result = await collection.replaceOne(
      {
        attemptId: input.attemptId,
        status: { $in: input.currentStatuses }
      },
      input.attempt,
      { session: this.getSession() }
    );

    return result.matchedCount === 1;
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
      { jobId: result.jobId },
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
        { key: { jobId: 1 }, unique: true },
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

export class MongoTelemetryEventRepositoryAdapter
  extends MongoRepositoryBase
  implements TelemetryEventRepositoryPort
{
  private indexesEnsured = false;

  public async save(event: TelemetryEventRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { telemetryEventId: event.telemetryEventId },
      event,
      { upsert: true, session: this.getSession() }
    );
  }

  public async listByJobId(jobId: string): Promise<TelemetryEventRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({ jobId }, { session: this.getSession() })
      .sort({ occurredAt: 1 })
      .toArray();
  }

  public async listByTraceId(traceId: string): Promise<TelemetryEventRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({ traceId }, { session: this.getSession() })
      .sort({ occurredAt: 1 })
      .toArray();
  }

  public async listByAttemptId(attemptId: string): Promise<TelemetryEventRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({ attemptId }, { session: this.getSession() })
      .sort({ occurredAt: 1 })
      .toArray();
  }

  private async getCollection(): Promise<Collection<TelemetryEventRecord>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<TelemetryEventRecord>('telemetry_events');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { telemetryEventId: 1 }, unique: true },
        { key: { jobId: 1, occurredAt: 1 } },
        { key: { traceId: 1, occurredAt: 1 } },
        { key: { attemptId: 1, occurredAt: 1 } },
        { key: { serviceName: 1, occurredAt: 1 } },
        { key: { retentionUntil: 1 }, expireAfterSeconds: 0 }
      ]);
      this.indexesEnsured = true;
    }

    return collection;
  }
}

export class MongoQueuePublicationOutboxRepositoryAdapter
  extends MongoRepositoryBase
  implements QueuePublicationOutboxRepositoryPort
{
  private indexesEnsured = false;

  public async save(record: QueuePublicationOutboxRecord): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { outboxId: record.outboxId },
      record,
      { upsert: true, session: this.getSession() }
    );
  }

  public async findById(outboxId: string): Promise<QueuePublicationOutboxRecord | undefined> {
    const collection = await this.getCollection();
    const record = await collection.findOne({ outboxId }, { session: this.getSession() });
    return record === null ? undefined : record;
  }

  public async findLatestByJobId(jobId: string): Promise<QueuePublicationOutboxRecord | undefined> {
    const collection = await this.getCollection();
    const record = await collection.findOne(
      { jobId },
      {
        session: this.getSession(),
        sort: { createdAt: -1 }
      }
    );

    return record === null ? undefined : record;
  }

  public async list(): Promise<QueuePublicationOutboxRecord[]> {
    const collection = await this.getCollection();
    return collection
      .find({}, { session: this.getSession() })
      .sort({ createdAt: -1 })
      .toArray();
  }

  public async claimAvailable(input: {
    ownerService: string;
    now: Date;
    limit: number;
    leaseMs: number;
    leaseOwner: string;
  }): Promise<QueuePublicationOutboxRecord[]> {
    const collection = await this.getCollection();
    const claimed: QueuePublicationOutboxRecord[] = [];
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);

    for (let index = 0; index < input.limit; index += 1) {
      const result = await collection.findOneAndUpdate(
        {
          ownerService: input.ownerService,
          status: QueuePublicationOutboxStatus.PENDING,
          availableAt: { $lte: input.now },
          $or: [{ leaseExpiresAt: { $lte: input.now } }, { leaseExpiresAt: { $exists: false } }]
        },
        {
          $set: {
            leaseOwner: input.leaseOwner,
            leaseExpiresAt,
            updatedAt: input.now
          },
          $inc: {
            publishAttempts: 1
          }
        },
        {
          session: this.getSession(),
          sort: { createdAt: 1 },
          returnDocument: 'after'
        }
      );

      if (result === null) {
        break;
      }

      claimed.push(result);
    }

    return claimed;
  }

  private async getCollection(): Promise<Collection<MongoQueuePublicationOutboxShape>> {
    const database = await this.provider.getDatabase();
    const collection = database.collection<MongoQueuePublicationOutboxShape>('queue_publication_outbox');
    if (!this.indexesEnsured) {
      await collection.createIndexes([
        { key: { outboxId: 1 }, unique: true },
        { key: { ownerService: 1, status: 1, availableAt: 1 } },
        { key: { jobId: 1, createdAt: -1 } },
        { key: { attemptId: 1, createdAt: -1 } },
        { key: { leaseExpiresAt: 1 } },
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
