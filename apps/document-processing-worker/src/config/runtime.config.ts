import {
  RuntimeResourceRegistry,
  buildObservabilityOverrides,
  createRegisteredMongoDatabaseProvider,
  createRegisteredRabbitMqJobPublisher,
  getRequiredEnv,
  parseBooleanEnv,
  parseNumberEnv,
  parseOptionalNumberEnv,
  resolveRuntimeMode,
  type RuntimeMode
} from '@document-parser/shared-infrastructure';
import type { BinaryStoragePort, JobPublisherPort } from '../contracts/ports';
import type { WorkerQueueListenerRuntime } from '../adapters/in/queue/processing-job-listener-lifecycle.service';
import { InMemoryQueuePublicationOutboxRepository } from '../adapters/out/repositories/in-memory.repositories';
import {
  MongoAuditRepositoryAdapter,
  MongoDeadLetterRepositoryAdapter,
  MongoDocumentRepositoryAdapter,
  MongoJobAttemptRepositoryAdapter,
  MongoPageArtifactRepositoryAdapter,
  MongoProcessingJobRepositoryAdapter,
  MongoProcessingResultRepositoryAdapter,
  MongoQueuePublicationOutboxRepositoryAdapter,
  MongoTelemetryEventRepositoryAdapter
} from '../adapters/out/repositories/mongodb.repositories';
import { MongoSessionContext, MongoUnitOfWorkAdapter } from '../adapters/out/repositories/mongodb.provider';
import { MinioBinaryStorageAdapter } from '../adapters/out/storage/minio-binary-storage.adapter';
import type { WorkerProviderOverrides } from '../app.module';
import { DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME } from '../application/services/queue-publication-outbox-dispatcher.service';

type WorkerRuntimeBootstrap = {
  mode: RuntimeMode;
  listenerRuntime: WorkerQueueListenerRuntime;
  overrides: WorkerProviderOverrides;
  runtimeResources: RuntimeResourceRegistry;
};

export function buildWorkerRuntimeBootstrapFromEnv(): WorkerRuntimeBootstrap {
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || 'document-parser-worker';
  const mode = resolveRuntimeMode(
    process.env.WORKER_RUNTIME_MODE ?? process.env.DOCUMENT_PARSER_RUNTIME_MODE ?? 'memory',
    'worker'
  );
  const runtimeResources = new RuntimeResourceRegistry();

  if (mode === 'memory') {
    return {
      mode,
      listenerRuntime: { mode: 'memory' },
      runtimeResources,
      overrides: {
        serviceName,
        runtimeResources,
        listenerRuntime: { mode: 'memory' },
        ...buildObservabilityOverrides(serviceName),
        storage: createNoopStorage(),
        publisher: createNoopPublisher(),
        queuePublicationOutbox: new InMemoryQueuePublicationOutboxRepository(),
        queuePublicationDispatcherRuntime: buildQueuePublicationDispatcherRuntimeFromEnv()
      }
    };
  }

  const queueName = getRequiredEnv('RABBITMQ_QUEUE_PROCESSING_REQUESTED');
  const rabbitMqUrl = getRequiredEnv('RABBITMQ_URL');
  const listenerRuntime: WorkerQueueListenerRuntime = {
    mode: 'real',
    queueName,
    rabbitMqUrl
  };
  const mongoProvider = createRegisteredMongoDatabaseProvider(getRequiredEnv('MONGODB_URI'), runtimeResources);
  const sessionContext = new MongoSessionContext();

  return {
    mode,
    listenerRuntime,
    runtimeResources,
    overrides: {
      serviceName,
      runtimeResources,
      listenerRuntime,
      ...buildObservabilityOverrides(serviceName),
      storage: new MinioBinaryStorageAdapter({
        endPoint: getRequiredEnv('MINIO_ENDPOINT'),
        port: parseNumberEnv('MINIO_PORT'),
        useSSL: parseBooleanEnv('MINIO_USE_SSL'),
        accessKey: getRequiredEnv('MINIO_ACCESS_KEY'),
        secretKey: getRequiredEnv('MINIO_SECRET_KEY')
      }),
      documents: new MongoDocumentRepositoryAdapter(mongoProvider, sessionContext),
      jobs: new MongoProcessingJobRepositoryAdapter(mongoProvider, sessionContext),
      attempts: new MongoJobAttemptRepositoryAdapter(mongoProvider, sessionContext),
      results: new MongoProcessingResultRepositoryAdapter(mongoProvider, sessionContext),
      artifacts: new MongoPageArtifactRepositoryAdapter(mongoProvider, sessionContext),
      deadLetters: new MongoDeadLetterRepositoryAdapter(mongoProvider, sessionContext),
      queuePublicationOutbox: new MongoQueuePublicationOutboxRepositoryAdapter(mongoProvider, sessionContext),
      audit: new MongoAuditRepositoryAdapter(mongoProvider, sessionContext),
      telemetry: new MongoTelemetryEventRepositoryAdapter(mongoProvider, sessionContext),
      publisher: createRegisteredRabbitMqJobPublisher(rabbitMqUrl, queueName, runtimeResources),
      queuePublicationDispatcherRuntime: buildQueuePublicationDispatcherRuntimeFromEnv(),
      unitOfWork: new MongoUnitOfWorkAdapter(mongoProvider, sessionContext)
    }
  };
}

function createNoopStorage(): BinaryStoragePort {
  return {
    async read(): Promise<Buffer> {
      return Buffer.alloc(0);
    }
  };
}

function createNoopPublisher(): JobPublisherPort {
  return {
    async publishRequested(): Promise<void> {
      return;
    },
    async publishRetry(): Promise<void> {
      return;
    }
  };
}

function buildQueuePublicationDispatcherRuntimeFromEnv() {
  return {
    pollIntervalMs: parseOptionalNumberEnv(
      'OUTBOX_POLL_INTERVAL_MS',
      DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME.pollIntervalMs
    ),
    batchSize: parseOptionalNumberEnv(
      'OUTBOX_BATCH_SIZE',
      DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME.batchSize
    ),
    leaseMs: parseOptionalNumberEnv(
      'OUTBOX_LEASE_MS',
      DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME.leaseMs
    )
  };
}
