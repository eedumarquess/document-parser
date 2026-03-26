import { connect as connectAmqp } from 'amqplib';
import { Client as MinioClient } from 'minio';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AttemptStatus,
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  InMemoryLoggingAdapter,
  InMemoryMetricsAdapter,
  InMemoryTracingAdapter,
  JobStatus,
  Role
} from '@document-parser/shared-kernel';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { buildActor } from '@document-parser/testkit';
import { DocumentProcessingWorkerModule } from '../../src/app.module';
import { RabbitMqProcessingJobListener } from '../../src/adapters/in/queue/rabbitmq-processing-job-listener';
import { ProcessingJobConsumer } from '../../src/adapters/in/queue/processing-job.consumer';
import { RabbitMqJobPublisherAdapter } from '../../src/adapters/out/queue/rabbitmq-job-publisher.adapter';
import {
  MongoAuditRepositoryAdapter,
  MongoDeadLetterRepositoryAdapter,
  MongoDocumentRepositoryAdapter,
  MongoJobAttemptRepositoryAdapter,
  MongoPageArtifactRepositoryAdapter,
  MongoProcessingJobRepositoryAdapter,
  MongoProcessingResultRepositoryAdapter
} from '../../src/adapters/out/repositories/mongodb.repositories';
import {
  MongoDatabaseProvider,
  MongoSessionContext,
  MongoUnitOfWorkAdapter
} from '../../src/adapters/out/repositories/mongodb.provider';
import { MinioBinaryStorageAdapter } from '../../src/adapters/out/storage/minio-binary-storage.adapter';

const describeRealInfra =
  process.env.RUN_REAL_INFRA_TESTS === 'true' ? describe : describe.skip;

describeRealInfra('Document processing worker real infrastructure', () => {
  jest.setTimeout(180_000);

  let mongoContainer: StartedTestContainer;
  let minioContainer: StartedTestContainer;
  let rabbitMqContainer: StartedTestContainer;
  let mongoProvider: MongoDatabaseProvider;
  let sessionContext: MongoSessionContext;
  let documents: MongoDocumentRepositoryAdapter;
  let jobs: MongoProcessingJobRepositoryAdapter;
  let attempts: MongoJobAttemptRepositoryAdapter;
  let results: MongoProcessingResultRepositoryAdapter;
  let artifacts: MongoPageArtifactRepositoryAdapter;
  let deadLetters: MongoDeadLetterRepositoryAdapter;
  let audit: MongoAuditRepositoryAdapter;
  let storage: MinioBinaryStorageAdapter;
  let publisher: RabbitMqJobPublisherAdapter;
  let listener: RabbitMqProcessingJobListener;
  let minioClient: MinioClient;
  let queueName: string;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    mongoContainer = await new GenericContainer('mongo:7.0')
      .withExposedPorts(27017)
      .withCommand(['--replSet', 'rs0', '--bind_ip_all'])
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/document-parser-worker?replicaSet=rs0`;

    await mongoContainer.exec([
      'mongosh',
      '--quiet',
      '--eval',
      `rs.initiate({_id:"rs0",members:[{_id:0,host:"${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}"}]})`
    ]);

    mongoProvider = new MongoDatabaseProvider(mongoUri);
    await waitForMongoReplicaSet(mongoProvider);
    sessionContext = new MongoSessionContext();
    documents = new MongoDocumentRepositoryAdapter(mongoProvider, sessionContext);
    jobs = new MongoProcessingJobRepositoryAdapter(mongoProvider, sessionContext);
    attempts = new MongoJobAttemptRepositoryAdapter(mongoProvider, sessionContext);
    results = new MongoProcessingResultRepositoryAdapter(mongoProvider, sessionContext);
    artifacts = new MongoPageArtifactRepositoryAdapter(mongoProvider, sessionContext);
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

    minioClient = new MinioClient({
      endPoint: minioContainer.getHost(),
      port: minioContainer.getMappedPort(9000),
      useSSL: false,
      accessKey: 'minio',
      secretKey: 'minio123'
    });
    storage = new MinioBinaryStorageAdapter({
      endPoint: minioContainer.getHost(),
      port: minioContainer.getMappedPort(9000),
      useSSL: false,
      accessKey: 'minio',
      secretKey: 'minio123'
    });

    rabbitMqContainer = await new GenericContainer('rabbitmq:3.13-management')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    queueName = 'document-processing.requested.real';
    const rabbitMqUrl = `amqp://guest:guest@${rabbitMqContainer.getHost()}:${rabbitMqContainer.getMappedPort(5672)}`;
    publisher = new RabbitMqJobPublisherAdapter(rabbitMqUrl, queueName);

    moduleRef = await Test.createTestingModule({
      imports: [
        DocumentProcessingWorkerModule.register({
          storage,
          documents,
          jobs,
          attempts,
          results,
          artifacts,
          deadLetters,
          audit,
          publisher,
          unitOfWork: new MongoUnitOfWorkAdapter(mongoProvider, sessionContext),
          logging: new InMemoryLoggingAdapter(),
          metrics: new InMemoryMetricsAdapter(),
          tracing: new InMemoryTracingAdapter()
        })
      ]
    }).compile();

    listener = new RabbitMqProcessingJobListener(
      rabbitMqUrl,
      queueName,
      moduleRef.get(ProcessingJobConsumer)
    );
    await listener.start();
  });

  afterEach(async () => {
    await purgeQueues(queueName, rabbitMqContainer);
  });

  afterAll(async () => {
    await listener?.close();
    await publisher?.close();
    await moduleRef?.close();
    await mongoProvider?.close();
    await rabbitMqContainer?.stop();
    await minioContainer?.stop();
    await mongoContainer?.stop();
  });

  it('processes a queued message end-to-end with real Mongo, MinIO and RabbitMQ', async () => {
    const seed = await seedQueuedJob({
      documentId: 'doc-worker-success',
      jobId: 'job-worker-success',
      attemptId: 'attempt-worker-success',
      buffer: Buffer.from('%PDF-1.4\n/Type /Page\nPaciente consciente. [[AMBIGUOUS_CHECKBOX:febre:checked]]')
    });

    await publisher.publishRequested(seed.message);

    const result = await waitFor(async () => results.findByJobId(seed.message.jobId));
    expect(result).toMatchObject({
      status: JobStatus.COMPLETED,
      engineUsed: 'OCR+LLM',
      payload: 'Paciente consciente. febre: [marcado]'
    });
    await expect(artifacts.listByJobId(seed.message.jobId)).resolves.toHaveLength(5);
    await expect(audit.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PROCESSING_COMPLETED',
          aggregateId: seed.message.attemptId
        })
      ])
    );
  });

  it('schedules a retry attempt and publishes the next message into the retry queue', async () => {
    const seed = await seedQueuedJob({
      documentId: 'doc-worker-retry',
      jobId: 'job-worker-retry',
      attemptId: 'attempt-worker-retry',
      buffer: Buffer.from('[[TRANSIENT_FAILURE]]')
    });

    await publisher.publishRequested(seed.message);

    const jobAttempts = await waitFor(async () => {
      const currentAttempts = await attempts.listByJobId(seed.message.jobId);
      return currentAttempts.length === 2 ? currentAttempts : undefined;
    });

    expect(jobAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptId: seed.message.attemptId,
          status: AttemptStatus.FAILED
        }),
        expect.objectContaining({
          status: AttemptStatus.QUEUED,
          attemptNumber: 2
        })
      ])
    );
    await expect(jobs.findById(seed.message.jobId)).resolves.toMatchObject({
      status: JobStatus.QUEUED
    });
    await expect(
      waitForQueueMessage(`${queueName}.retry.1`, rabbitMqContainer, true)
    ).resolves.toMatchObject({
      jobId: seed.message.jobId,
      documentId: seed.message.documentId
    });
    await expect(deadLetters.list()).resolves.toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          jobId: seed.message.jobId
        })
      ])
    );
  });

  it('persists application DLQ and routes the original message to the broker DLQ on terminal failure', async () => {
    const seed = await seedQueuedJob({
      documentId: 'doc-worker-dlq',
      jobId: 'job-worker-dlq',
      attemptId: 'attempt-worker-dlq',
      buffer: Buffer.from('[[FATAL_FAILURE]]')
    });

    await publisher.publishRequested(seed.message);

    const deadLetter = await waitFor(async () => {
      const currentDeadLetters = await deadLetters.list();
      return currentDeadLetters.find((record) => record.jobId === seed.message.jobId);
    });

    expect(deadLetter).toMatchObject({
      jobId: seed.message.jobId,
      attemptId: seed.message.attemptId,
      reasonCode: 'FATAL_FAILURE'
    });
    await expect(jobs.findById(seed.message.jobId)).resolves.toMatchObject({
      status: JobStatus.FAILED
    });
    await expect(
      waitForQueueMessage(`${queueName}.dlq`, rabbitMqContainer, true)
    ).resolves.toMatchObject({
      jobId: seed.message.jobId,
      documentId: seed.message.documentId,
      attemptId: seed.message.attemptId
    });
  });

  it('creates the worker collections and TTL indexes for observable data', async () => {
    const database = await mongoProvider.getDatabase();
    const collectionNames = (await database.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();

    expect(collectionNames).toEqual(
      expect.arrayContaining([
        'audit_events',
        'dead_letter_events',
        'documents',
        'job_attempts',
        'page_artifacts',
        'processing_jobs',
        'processing_results'
      ])
    );

    const pageArtifactIndexes = await database.collection('page_artifacts').indexes();
    const resultIndexes = await database.collection('processing_results').indexes();
    const deadLetterIndexes = await database.collection('dead_letter_events').indexes();
    const auditIndexes = await database.collection('audit_events').indexes();

    expect(pageArtifactIndexes).toEqual(
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
    expect(auditIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { retentionUntil: 1 },
          expireAfterSeconds: 0
        })
      ])
    );
  });

  async function seedQueuedJob(input: {
    documentId: string;
    jobId: string;
    attemptId: string;
    buffer: Buffer;
    attemptNumber?: number;
  }) {
    await ensureBucket('documents');
    const objectKey = `original/${input.documentId}/sample.pdf`;
    await minioClient.putObject('documents', objectKey, input.buffer, input.buffer.byteLength, {
      'Content-Type': 'application/pdf'
    });

    const now = new Date('2026-03-25T12:00:00.000Z');
    const message = {
      documentId: input.documentId,
      jobId: input.jobId,
      attemptId: input.attemptId,
      traceId: `trace-${input.jobId}`,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      publishedAt: now.toISOString()
    };

    await documents.save({
      documentId: input.documentId,
      hash: `sha256:${input.documentId}`,
      originalFileName: 'sample.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: input.buffer.byteLength,
      pageCount: Math.max(1, input.buffer.toString('utf8').split('[[PAGE_BREAK]]').length),
      sourceType: 'MULTIPART',
      storageReference: {
        bucket: 'documents',
        objectKey
      },
      retentionUntil: new Date('2026-04-24T12:00:00.000Z'),
      createdAt: now,
      updatedAt: now
    });
    await jobs.save({
      jobId: input.jobId,
      documentId: input.documentId,
      requestedMode: 'STANDARD',
      priority: 'NORMAL',
      queueName,
      status: JobStatus.QUEUED,
      forceReprocess: false,
      reusedResult: false,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      acceptedAt: now,
      queuedAt: now,
      requestedBy: buildActor({ role: Role.OWNER }),
      warnings: [],
      ingestionTransitions: [{ status: JobStatus.QUEUED, at: now }],
      createdAt: now,
      updatedAt: now
    });
    await attempts.save({
      attemptId: input.attemptId,
      jobId: input.jobId,
      attemptNumber: input.attemptNumber ?? 1,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      status: AttemptStatus.QUEUED,
      fallbackUsed: false,
      createdAt: now
    });

    return { message };
  }

  async function ensureBucket(bucket: string) {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket);
    }
  }
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

async function waitFor<T>(work: () => Promise<T | undefined>, attempts = 30, delayMs = 200): Promise<T> {
  for (let index = 0; index < attempts; index += 1) {
    const result = await work();
    if (result !== undefined) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Timed out waiting for asynchronous worker condition');
}

async function waitForQueueMessage(
  queueName: string,
  rabbitMqContainer: StartedTestContainer,
  noAck: boolean
): Promise<Record<string, unknown>> {
  const rabbitMqUrl = `amqp://guest:guest@${rabbitMqContainer.getHost()}:${rabbitMqContainer.getMappedPort(5672)}`;
  const connection = await connectAmqp(rabbitMqUrl);
  const channel = await connection.createChannel();
  await channel.assertQueue(queueName, { durable: true });

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const message = await channel.get(queueName, { noAck });
      if (message !== false) {
        return JSON.parse(message.content.toString('utf8')) as Record<string, unknown>;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await channel.close();
    await connection.close();
  }

  throw new Error(`Expected message in queue ${queueName}`);
}

async function purgeQueues(queueName: string, rabbitMqContainer: StartedTestContainer): Promise<void> {
  const rabbitMqUrl = `amqp://guest:guest@${rabbitMqContainer.getHost()}:${rabbitMqContainer.getMappedPort(5672)}`;
  const connection = await connectAmqp(rabbitMqUrl);
  const channel = await connection.createChannel();

  try {
    for (const name of [
      queueName,
      `${queueName}.retry.1`,
      `${queueName}.retry.2`,
      `${queueName}.retry.3`,
      `${queueName}.dlq`
    ]) {
      await channel.assertQueue(name, { durable: true });
      await channel.purgeQueue(name);
    }
  } finally {
    await channel.close();
    await connection.close();
  }
}
