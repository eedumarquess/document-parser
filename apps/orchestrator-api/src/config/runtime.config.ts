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
import {
  InMemoryAuditRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryQueuePublicationOutboxRepository,
  InMemoryUnitOfWork
} from '../adapters/out/repositories/in-memory.repositories';
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
import { InMemoryBinaryStorageAdapter } from '../adapters/out/storage/in-memory-binary-storage.adapter';
import { MinioBinaryStorageAdapter } from '../adapters/out/storage/minio-binary-storage.adapter';
import { InMemoryJobPublisherAdapter } from '../adapters/out/queue/in-memory-job-publisher.adapter';
import type { OrchestratorProviderOverrides } from '../app.module';
import { DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME } from '../application/services/queue-publication-outbox-dispatcher.service';

export type OrchestratorRuntimeBootstrap = {
  mode: RuntimeMode;
  overrides: OrchestratorProviderOverrides;
  runtimeResources: RuntimeResourceRegistry;
};

export function buildOrchestratorRuntimeBootstrapFromEnv(): OrchestratorRuntimeBootstrap {
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || 'document-parser-orchestrator-api';
  const mode = resolveRuntimeMode(
    process.env.ORCHESTRATOR_RUNTIME_MODE ?? process.env.DOCUMENT_PARSER_RUNTIME_MODE ?? 'memory',
    'orchestrator'
  );
  const runtimeResources = new RuntimeResourceRegistry();

  if (mode === 'memory') {
    const results = new InMemoryProcessingResultRepository();
    return {
      mode,
      runtimeResources,
      overrides: {
        serviceName,
        runtimeResources,
        ...buildObservabilityOverrides(serviceName),
        storage: new InMemoryBinaryStorageAdapter(),
        documents: new InMemoryDocumentRepository(),
        jobs: new InMemoryProcessingJobRepository(),
        attempts: new InMemoryJobAttemptRepository(),
        results,
        compatibleResults: results,
        publisher: new InMemoryJobPublisherAdapter(),
        queuePublicationOutbox: new InMemoryQueuePublicationOutboxRepository(),
        queuePublicationDispatcherRuntime: buildQueuePublicationDispatcherRuntimeFromEnv(),
        audit: new InMemoryAuditRepository(),
        unitOfWork: new InMemoryUnitOfWork()
      }
    };
  }

  const mongoProvider = createRegisteredMongoDatabaseProvider(getRequiredEnv('MONGODB_URI'), runtimeResources);
  const sessionContext = new MongoSessionContext();
  const results = new MongoProcessingResultRepositoryAdapter(mongoProvider, sessionContext);

  return {
    mode,
    runtimeResources,
    overrides: {
      serviceName,
      runtimeResources,
      ...buildObservabilityOverrides(serviceName),
      storage: new MinioBinaryStorageAdapter({
        endPoint: getRequiredEnv('MINIO_ENDPOINT'),
        port: parseNumberEnv('MINIO_PORT'),
        useSSL: parseBooleanEnv('MINIO_USE_SSL'),
        accessKey: getRequiredEnv('MINIO_ACCESS_KEY'),
        secretKey: getRequiredEnv('MINIO_SECRET_KEY'),
        bucket: getRequiredEnv('MINIO_BUCKET_ORIGINALS')
      }),
      documents: new MongoDocumentRepositoryAdapter(mongoProvider, sessionContext),
      jobs: new MongoProcessingJobRepositoryAdapter(mongoProvider, sessionContext),
      attempts: new MongoJobAttemptRepositoryAdapter(mongoProvider, sessionContext),
      results,
      artifacts: new MongoPageArtifactRepositoryAdapter(mongoProvider, sessionContext),
      deadLetters: new MongoDeadLetterRepositoryAdapter(mongoProvider, sessionContext),
      queuePublicationOutbox: new MongoQueuePublicationOutboxRepositoryAdapter(mongoProvider, sessionContext),
      compatibleResults: results,
      telemetry: new MongoTelemetryEventRepositoryAdapter(mongoProvider, sessionContext),
      publisher: createRegisteredRabbitMqJobPublisher(
        getRequiredEnv('RABBITMQ_URL'),
        getRequiredEnv('RABBITMQ_QUEUE_PROCESSING_REQUESTED'),
        runtimeResources
      ),
      queuePublicationDispatcherRuntime: buildQueuePublicationDispatcherRuntimeFromEnv(),
      audit: new MongoAuditRepositoryAdapter(mongoProvider, sessionContext),
      unitOfWork: new MongoUnitOfWorkAdapter(mongoProvider, sessionContext)
    }
  };
}

export function buildOrchestratorProviderOverridesFromEnv(): OrchestratorProviderOverrides {
  return buildOrchestratorRuntimeBootstrapFromEnv().overrides;
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
