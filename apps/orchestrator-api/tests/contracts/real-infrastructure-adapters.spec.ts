import { connect as connectAmqp } from 'amqplib';
import { AttemptStatus, JobStatus, Role } from '@document-parser/shared-kernel';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { buildActor } from '@document-parser/testkit';
import { RabbitMqJobPublisherAdapter } from '../../src/adapters/out/queue/rabbitmq-job-publisher.adapter';
import {
  MongoAuditRepositoryAdapter,
  MongoDeadLetterRepositoryAdapter,
  MongoDocumentRepositoryAdapter,
  MongoJobAttemptRepositoryAdapter,
  MongoProcessingJobRepositoryAdapter,
  MongoProcessingResultRepositoryAdapter
} from '../../src/adapters/out/repositories/mongodb.repositories';
import { MongoDatabaseProvider, MongoSessionContext, MongoUnitOfWorkAdapter } from '../../src/adapters/out/repositories/mongodb.provider';
import { MinioBinaryStorageAdapter } from '../../src/adapters/out/storage/minio-binary-storage.adapter';
import { CompatibilityKey } from '../../src/domain/value-objects/compatibility-key';

const expectNoTemplateFields = (payload: Record<string, unknown>) => {
  expect(payload).not.toHaveProperty('templateId');
  expect(payload).not.toHaveProperty('templateVersion');
  expect(payload).not.toHaveProperty('templateStatus');
  expect(payload).not.toHaveProperty('matchingRules');
};

const describeRealInfra =
  process.env.RUN_REAL_INFRA_TESTS === 'true' ? describe : describe.skip;

describeRealInfra('Real infrastructure adapter contracts', () => {
  jest.setTimeout(180_000);

  let mongoContainer: StartedTestContainer;
  let minioContainer: StartedTestContainer;
  let rabbitMqContainer: StartedTestContainer;
  let mongoProvider: MongoDatabaseProvider;
  let sessionContext: MongoSessionContext;
  let unitOfWork: MongoUnitOfWorkAdapter;
  let documents: MongoDocumentRepositoryAdapter;
  let jobs: MongoProcessingJobRepositoryAdapter;
  let attempts: MongoJobAttemptRepositoryAdapter;
  let results: MongoProcessingResultRepositoryAdapter;
  let deadLetters: MongoDeadLetterRepositoryAdapter;
  let audit: MongoAuditRepositoryAdapter;
  let storage: MinioBinaryStorageAdapter;
  let publisher: RabbitMqJobPublisherAdapter;
  let rabbitMqUrl: string;
  let queueName: string;

  beforeAll(async () => {
    mongoContainer = await new GenericContainer('mongo:7.0')
      .withExposedPorts(27017)
      .withCommand(['--replSet', 'rs0', '--bind_ip_all'])
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/document-parser?replicaSet=rs0`;

    await mongoContainer.exec([
      'mongosh',
      '--quiet',
      '--eval',
      `rs.initiate({_id:"rs0",members:[{_id:0,host:"${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}"}]})`
    ]);

    mongoProvider = new MongoDatabaseProvider(mongoUri);
    await waitForMongoReplicaSet(mongoProvider);
    sessionContext = new MongoSessionContext();
    unitOfWork = new MongoUnitOfWorkAdapter(mongoProvider, sessionContext);
    documents = new MongoDocumentRepositoryAdapter(mongoProvider, sessionContext);
    jobs = new MongoProcessingJobRepositoryAdapter(mongoProvider, sessionContext);
    attempts = new MongoJobAttemptRepositoryAdapter(mongoProvider, sessionContext);
    results = new MongoProcessingResultRepositoryAdapter(mongoProvider, sessionContext);
    deadLetters = new MongoDeadLetterRepositoryAdapter(mongoProvider, sessionContext);
    audit = new MongoAuditRepositoryAdapter(mongoProvider, sessionContext);

    minioContainer = await new GenericContainer('minio/minio:RELEASE.2024-03-30T09-41-56Z')
      .withExposedPorts(9000)
      .withEnvironment({
        MINIO_ROOT_USER: 'minio',
        MINIO_ROOT_PASSWORD: 'minio123'
      })
      .withCommand(['server', '/data'])
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    storage = new MinioBinaryStorageAdapter({
      endPoint: minioContainer.getHost(),
      port: minioContainer.getMappedPort(9000),
      useSSL: false,
      accessKey: 'minio',
      secretKey: 'minio123',
      bucket: 'documents'
    });

    rabbitMqContainer = await new GenericContainer('rabbitmq:3.13-management')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    rabbitMqUrl = `amqp://guest:guest@${rabbitMqContainer.getHost()}:${rabbitMqContainer.getMappedPort(5672)}`;
    queueName = 'document-processing.requested';
    publisher = new RabbitMqJobPublisherAdapter(rabbitMqUrl, queueName);
  });

  afterAll(async () => {
    await publisher?.close();
    await mongoProvider?.close();
    await rabbitMqContainer?.stop();
    await minioContainer?.stop();
    await mongoContainer?.stop();
  });

  it('persists records through Mongo repositories and resolves the latest compatible result', async () => {
    const now = new Date('2026-03-25T12:00:00.000Z');
    const compatibilityKey = CompatibilityKey.build({
      hash: 'sha256:doc-1',
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      outputVersion: '1.0.0'
    });

    await unitOfWork.runInTransaction(async () => {
      await documents.save({
        documentId: 'doc-1',
        hash: 'sha256:doc-1',
        originalFileName: 'sample.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 100,
        pageCount: 2,
        sourceType: 'MULTIPART',
        storageReference: {
          bucket: 'documents',
          objectKey: 'original/doc-1/sample.pdf'
        },
        retentionUntil: now,
        createdAt: now,
        updatedAt: now
      });
      await jobs.save({
        jobId: 'job-1',
        documentId: 'doc-1',
        requestedMode: 'STANDARD',
        priority: 'NORMAL',
        queueName,
        status: JobStatus.QUEUED,
        forceReprocess: false,
        reusedResult: false,
        pipelineVersion: 'git-sha',
        outputVersion: '1.0.0',
        acceptedAt: now,
        queuedAt: now,
        requestedBy: buildActor({ role: Role.OWNER }),
        warnings: [],
        ingestionTransitions: [
          { status: JobStatus.RECEIVED, at: now },
          { status: JobStatus.VALIDATED, at: now },
          { status: JobStatus.STORED, at: now },
          { status: JobStatus.QUEUED, at: now }
        ],
        createdAt: now,
        updatedAt: now
      });
      await attempts.save({
        attemptId: 'attempt-1',
        jobId: 'job-1',
        attemptNumber: 1,
        pipelineVersion: 'git-sha',
        status: AttemptStatus.QUEUED,
        fallbackUsed: false,
        createdAt: now
      });
      await results.save({
        resultId: 'result-older',
        jobId: 'job-1',
        documentId: 'doc-1',
        compatibilityKey,
        status: JobStatus.COMPLETED,
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        outputVersion: '1.0.0',
        confidence: 0.8,
        warnings: [],
        payload: 'older',
        engineUsed: 'OCR',
        totalLatencyMs: 100,
        createdAt: new Date('2026-03-25T12:00:00.000Z'),
        updatedAt: new Date('2026-03-25T12:00:00.000Z'),
        retentionUntil: new Date('2026-06-23T12:00:00.000Z')
      });
      await results.save({
        resultId: 'result-newer',
        jobId: 'job-2',
        documentId: 'doc-1',
        compatibilityKey,
        status: JobStatus.PARTIAL,
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        outputVersion: '1.0.0',
        confidence: 0.9,
        warnings: ['ILLEGIBLE_CONTENT'],
        payload: 'newer',
        engineUsed: 'OCR',
        totalLatencyMs: 110,
        createdAt: new Date('2026-03-25T12:05:00.000Z'),
        updatedAt: new Date('2026-03-25T12:05:00.000Z'),
        retentionUntil: new Date('2026-06-23T12:05:00.000Z')
      });
      await audit.record({
        eventId: 'audit-1',
        eventType: 'DOCUMENT_ACCEPTED',
        aggregateType: 'PROCESSING_JOB',
        aggregateId: 'job-1',
        traceId: 'trace-1',
        actor: buildActor(),
        metadata: { jobId: 'job-1' },
        redactedPayload: { jobId: 'job-1' },
        createdAt: now,
        retentionUntil: new Date('2026-09-21T12:00:00.000Z')
      });
      await deadLetters.save({
        dlqEventId: 'dlq-1',
        jobId: 'job-1',
        attemptId: 'attempt-1',
        traceId: 'trace-1',
        queueName,
        reasonCode: 'DLQ_ERROR',
        reasonMessage: 'retries exhausted',
        retryCount: 3,
        payloadSnapshot: { jobId: 'job-1', attemptId: 'attempt-1' },
        firstSeenAt: now,
        lastSeenAt: now,
        retentionUntil: new Date('2026-09-21T12:00:00.000Z')
      });
    });

    await expect(documents.findByHash('sha256:doc-1')).resolves.toMatchObject({
      documentId: 'doc-1'
    });
    await expect(jobs.findById('job-1')).resolves.toMatchObject({
      status: JobStatus.QUEUED
    });
    await expect(attempts.findById('attempt-1')).resolves.toMatchObject({
      attemptNumber: 1
    });
    await expect(
      results.findByCompatibilityKey({
        hash: 'sha256:doc-1',
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        outputVersion: '1.0.0'
      })
    ).resolves.toMatchObject({
      resultId: 'result-newer',
      status: JobStatus.PARTIAL
    });
    await expect(audit.list()).resolves.toHaveLength(1);
    await expect(deadLetters.findById('dlq-1')).resolves.toMatchObject({
      jobId: 'job-1'
    });
  });

  it('rolls back Mongo writes when the unit of work fails', async () => {
    const now = new Date('2026-03-25T12:30:00.000Z');

    await expect(
      unitOfWork.runInTransaction(async () => {
        await documents.save({
          documentId: 'doc-rollback',
          hash: 'sha256:rollback',
          originalFileName: 'rollback.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 10,
          pageCount: 1,
          sourceType: 'MULTIPART',
          storageReference: {
            bucket: 'documents',
            objectKey: 'original/doc-rollback/rollback.pdf'
          },
          retentionUntil: now,
          createdAt: now,
          updatedAt: now
        });
        throw new Error('abort transaction');
      })
    ).rejects.toThrow('abort transaction');

    await expect(documents.findById('doc-rollback')).resolves.toBeUndefined();
  });

  it('keeps a single persisted processing result per jobId', async () => {
    const now = new Date('2026-03-25T12:40:00.000Z');

    await results.save({
      resultId: 'result-job-unique-1',
      jobId: 'job-unique',
      documentId: 'doc-unique',
      compatibilityKey: 'compatibility-unique',
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      outputVersion: '1.0.0',
      confidence: 0.7,
      warnings: [],
      payload: 'payload antigo',
      engineUsed: 'OCR',
      totalLatencyMs: 100,
      createdAt: now,
      updatedAt: now,
      retentionUntil: new Date('2026-06-23T12:40:00.000Z')
    });
    await results.save({
      resultId: 'result-job-unique-2',
      jobId: 'job-unique',
      documentId: 'doc-unique',
      compatibilityKey: 'compatibility-unique',
      status: JobStatus.PARTIAL,
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      outputVersion: '1.0.0',
      confidence: 0.9,
      warnings: ['ILLEGIBLE_CONTENT'],
      payload: 'payload novo',
      engineUsed: 'OCR+LLM',
      totalLatencyMs: 150,
      createdAt: new Date('2026-03-25T12:41:00.000Z'),
      updatedAt: new Date('2026-03-25T12:41:00.000Z'),
      retentionUntil: new Date('2026-06-23T12:41:00.000Z')
    });

    await expect(results.findByJobId('job-unique')).resolves.toMatchObject({
      resultId: 'result-job-unique-2',
      payload: 'payload novo',
      status: JobStatus.PARTIAL
    });

    const database = await mongoProvider.getDatabase();
    await expect(database.collection('processing_results').countDocuments({ jobId: 'job-unique' })).resolves.toBe(1);
  });

  it('keeps only the current orchestrator Mongo collections and no template collections', async () => {
    const database = await mongoProvider.getDatabase();
    const collectionNames = (await database.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();

    expect(collectionNames).toEqual([
      'audit_events',
      'dead_letter_events',
      'documents',
      'job_attempts',
      'processing_jobs',
      'processing_results'
    ]);
    expect(collectionNames).not.toContain('templates');
    expect(collectionNames).not.toContain('template_versions');
  });

  it('stores, reads, and deletes the original binary in MinIO', async () => {
    const reference = await storage.storeOriginal({
      documentId: 'doc-storage',
      mimeType: 'application/pdf',
      originalName: 'sample.pdf',
      buffer: Buffer.from('minio payload')
    });

    await expect(storage.read(reference)).resolves.toEqual(Buffer.from('minio payload'));

    await storage.delete(reference);

    await expect(storage.read(reference)).rejects.toThrow('Stored binary not found');
  });

  it('creates TTL indexes for observable collections', async () => {
    const database = await mongoProvider.getDatabase();

    const auditIndexes = await database.collection('audit_events').indexes();
    const resultIndexes = await database.collection('processing_results').indexes();
    const deadLetterIndexes = await database.collection('dead_letter_events').indexes();

    expect(auditIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { retentionUntil: 1 },
          expireAfterSeconds: 0
        })
      ])
    );
    expect(resultIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { jobId: 1 },
          unique: true
        }),
        expect.objectContaining({
          key: { retentionUntil: 1 },
          expireAfterSeconds: 0
        })
      ])
    );
    expect(deadLetterIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { retentionUntil: 1 },
          expireAfterSeconds: 0
        })
      ])
    );
  });

  it('publishes the minimal queue contract to RabbitMQ', async () => {
    const payload = {
      documentId: 'doc-1',
      jobId: 'job-1',
      attemptId: 'attempt-1',
      traceId: 'trace-queue-1',
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      publishedAt: '2026-03-25T12:00:00.000Z'
    };
    await publisher.publishRequested(payload);

    const connection = await connectAmqp(rabbitMqUrl);
    const channel = await connection.createChannel();
    await channel.assertQueue(queueName, { durable: true });
    const message = await channel.get(queueName, { noAck: true });

    expect(message).not.toBe(false);
    const parsedPayload = JSON.parse(message ? message.content.toString('utf8') : '{}') as Record<string, unknown>;
    expect(parsedPayload).toEqual(payload);
    expect(Object.keys(parsedPayload).sort()).toEqual(
      ['attemptId', 'documentId', 'jobId', 'pipelineVersion', 'publishedAt', 'requestedMode', 'traceId'].sort()
    );
    expectNoTemplateFields(parsedPayload);

    await channel.close();
    await connection.close();
  });

  it('routes retry messages back to the main queue after TTL', async () => {
    const payload = {
      documentId: 'doc-retry',
      jobId: 'job-retry',
      attemptId: 'attempt-retry',
      traceId: 'trace-retry-1',
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      publishedAt: '2026-03-25T12:00:02.000Z'
    };
    await publisher.publishRetry(payload, 1);

    const connection = await connectAmqp(rabbitMqUrl);
    const channel = await connection.createChannel();
    await channel.assertQueue(queueName, { durable: true });

    let retriedMessage = await channel.get(queueName, { noAck: true });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (retriedMessage !== false) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
      retriedMessage = await channel.get(queueName, { noAck: true });
    }

    expect(retriedMessage).not.toBe(false);
    if (retriedMessage === false) {
      throw new Error('expected message to return from retry queue');
    }
    const parsedPayload = JSON.parse(retriedMessage.content.toString('utf8')) as Record<string, unknown>;
    expect(parsedPayload).toEqual(payload);
    expect(Object.keys(parsedPayload).sort()).toEqual(
      ['attemptId', 'documentId', 'jobId', 'pipelineVersion', 'publishedAt', 'requestedMode', 'traceId'].sort()
    );
    expectNoTemplateFields(parsedPayload);

    await channel.close();
    await connection.close();
  });

  it('dead-letters rejected main-queue messages to the broker DLQ', async () => {
    const payload = {
      documentId: 'doc-dlq',
      jobId: 'job-dlq',
      attemptId: 'attempt-dlq',
      traceId: 'trace-dlq-1',
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      publishedAt: '2026-03-25T12:00:03.000Z'
    };
    await publisher.publishRequested(payload);

    const connection = await connectAmqp(rabbitMqUrl);
    const channel = await connection.createChannel();
    await channel.assertQueue(queueName, { durable: true });
    await channel.assertQueue(`${queueName}.dlq`, { durable: true });

    const message = await channel.get(queueName, { noAck: false });
    expect(message).not.toBe(false);
    if (message === false) {
      throw new Error('expected message in main queue');
    }
    channel.nack(message, false, false);

    const dlqMessage = await channel.get(`${queueName}.dlq`, { noAck: true });
    expect(dlqMessage).not.toBe(false);
    const parsedPayload = JSON.parse(dlqMessage ? dlqMessage.content.toString('utf8') : '{}') as Record<string, unknown>;
    expect(parsedPayload).toEqual(payload);
    expectNoTemplateFields(parsedPayload);

    await channel.close();
    await connection.close();
  });
});

async function waitForMongoReplicaSet(provider: MongoDatabaseProvider): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await provider.getDatabase();
      await provider.getClient();
      await provider.getDatabase().then((database) => database.admin().command({ ping: 1 }));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error('Mongo replica set did not become available in time');
}
