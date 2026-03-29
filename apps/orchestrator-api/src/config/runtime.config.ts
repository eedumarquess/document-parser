import {
  createOtlpHttpObservabilityAdapters,
  parseOtlpHeaders
} from '@document-parser/shared-kernel';
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
import { MongoDatabaseProvider, MongoSessionContext, MongoUnitOfWorkAdapter } from '../adapters/out/repositories/mongodb.provider';
import { InMemoryBinaryStorageAdapter } from '../adapters/out/storage/in-memory-binary-storage.adapter';
import { MinioBinaryStorageAdapter } from '../adapters/out/storage/minio-binary-storage.adapter';
import { InMemoryJobPublisherAdapter } from '../adapters/out/queue/in-memory-job-publisher.adapter';
import { RabbitMqJobPublisherAdapter } from '../adapters/out/queue/rabbitmq-job-publisher.adapter';
import type { OrchestratorProviderOverrides } from '../app.module';
import { DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME } from '../application/services/queue-publication-outbox-dispatcher.service';

type RuntimeMode = 'memory' | 'real';

export function buildOrchestratorProviderOverridesFromEnv(): OrchestratorProviderOverrides {
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || 'document-parser-orchestrator-api';
  const mode = resolveRuntimeMode(
    process.env.ORCHESTRATOR_RUNTIME_MODE ?? process.env.DOCUMENT_PARSER_RUNTIME_MODE ?? 'memory'
  );

  if (mode === 'memory') {
    const results = new InMemoryProcessingResultRepository();
    return {
      serviceName,
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
    };
  }

  const mongoProvider = new MongoDatabaseProvider(getRequiredEnv('MONGODB_URI'));
  const sessionContext = new MongoSessionContext();
  const results = new MongoProcessingResultRepositoryAdapter(mongoProvider, sessionContext);

  return {
    serviceName,
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
    publisher: new RabbitMqJobPublisherAdapter(
      getRequiredEnv('RABBITMQ_URL'),
      getRequiredEnv('RABBITMQ_QUEUE_PROCESSING_REQUESTED')
    ),
    queuePublicationDispatcherRuntime: buildQueuePublicationDispatcherRuntimeFromEnv(),
    audit: new MongoAuditRepositoryAdapter(mongoProvider, sessionContext),
    unitOfWork: new MongoUnitOfWorkAdapter(mongoProvider, sessionContext)
  };
}

function resolveRuntimeMode(value: string): RuntimeMode {
  if (value === 'memory' || value === 'real') {
    return value;
  }

  throw new Error(`Unsupported orchestrator runtime mode: ${value}`);
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseNumberEnv(name: string): number {
  const value = Number(getRequiredEnv(name));
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return value;
}

function parseBooleanEnv(name: string): boolean {
  const value = getRequiredEnv(name).toLowerCase();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  throw new Error(`Environment variable ${name} must be "true" or "false"`);
}

function buildObservabilityOverrides(serviceName: string) {
  const mode = (process.env.OBSERVABILITY_MODE ?? 'local').trim().toLowerCase();

  if (mode === '' || mode === 'local') {
    return {};
  }

  if (mode !== 'otlp') {
    console.warn(`Unsupported OBSERVABILITY_MODE "${mode}". Falling back to local adapters.`);
    return {};
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (endpoint === undefined || endpoint === '') {
    console.warn('Missing OTEL_EXPORTER_OTLP_ENDPOINT. Falling back to local adapters.');
    return {};
  }

  return createOtlpHttpObservabilityAdapters({
    endpoint,
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || serviceName,
    headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS)
  });
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

function parseOptionalNumberEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return value;
}
