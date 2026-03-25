import { connect as connectAmqp } from 'amqplib';
import { AttemptStatus, JobStatus, Role } from '@document-parser/shared-kernel';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { buildActor } from '@document-parser/testkit';
import { RabbitMqJobPublisherAdapter } from '../../src/adapters/out/queue/rabbitmq-job-publisher.adapter';
import {
  MongoAuditRepositoryAdapter,
  MongoDocumentRepositoryAdapter,
  MongoJobAttemptRepositoryAdapter,
  MongoProcessingJobRepositoryAdapter,
  MongoProcessingResultRepositoryAdapter
} from '../../src/adapters/out/repositories/mongodb.repositories';
import { MongoDatabaseProvider, MongoSessionContext, MongoUnitOfWorkAdapter } from '../../src/adapters/out/repositories/mongodb.provider';
import { MinioBinaryStorageAdapter } from '../../src/adapters/out/storage/minio-binary-storage.adapter';
import { CompatibilityKey } from '../../src/domain/value-objects/compatibility-key';

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
        updatedAt: new Date('2026-03-25T12:00:00.000Z')
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
        updatedAt: new Date('2026-03-25T12:05:00.000Z')
      });
      await results.save({
        resultId: 'result-failed',
        jobId: 'job-3',
        documentId: 'doc-1',
        compatibilityKey,
        status: JobStatus.FAILED,
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        outputVersion: '1.0.0',
        confidence: 0,
        warnings: [],
        payload: 'failed',
        engineUsed: 'OCR',
        totalLatencyMs: 120,
        createdAt: new Date('2026-03-25T12:10:00.000Z'),
        updatedAt: new Date('2026-03-25T12:10:00.000Z')
      });
      await audit.record({
        eventId: 'audit-1',
        eventType: 'DOCUMENT_ACCEPTED',
        actor: buildActor(),
        metadata: { jobId: 'job-1' },
        createdAt: now
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

  it('publishes the minimal queue contract to RabbitMQ', async () => {
    await publisher.publish({
      documentId: 'doc-1',
      jobId: 'job-1',
      attemptId: 'attempt-1',
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      publishedAt: '2026-03-25T12:00:00.000Z'
    });

    const connection = await connectAmqp(rabbitMqUrl);
    const channel = await connection.createChannel();
    await channel.assertQueue(queueName, { durable: true });
    const message = await channel.get(queueName, { noAck: true });

    expect(message).not.toBe(false);
    expect(message && message.content.toString('utf8')).toBe(
      JSON.stringify({
        documentId: 'doc-1',
        jobId: 'job-1',
        attemptId: 'attempt-1',
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        publishedAt: '2026-03-25T12:00:00.000Z'
      })
    );

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
