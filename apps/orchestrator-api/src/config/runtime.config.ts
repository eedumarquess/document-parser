import { InMemoryAuditRepository, InMemoryDocumentRepository, InMemoryJobAttemptRepository, InMemoryProcessingJobRepository, InMemoryProcessingResultRepository, InMemoryUnitOfWork } from '../adapters/out/repositories/in-memory.repositories';
import {
  MongoAuditRepositoryAdapter,
  MongoDocumentRepositoryAdapter,
  MongoJobAttemptRepositoryAdapter,
  MongoProcessingJobRepositoryAdapter,
  MongoProcessingResultRepositoryAdapter
} from '../adapters/out/repositories/mongodb.repositories';
import { MongoDatabaseProvider, MongoSessionContext, MongoUnitOfWorkAdapter } from '../adapters/out/repositories/mongodb.provider';
import { InMemoryBinaryStorageAdapter } from '../adapters/out/storage/in-memory-binary-storage.adapter';
import { MinioBinaryStorageAdapter } from '../adapters/out/storage/minio-binary-storage.adapter';
import { InMemoryJobPublisherAdapter } from '../adapters/out/queue/in-memory-job-publisher.adapter';
import { RabbitMqJobPublisherAdapter } from '../adapters/out/queue/rabbitmq-job-publisher.adapter';
import type { OrchestratorProviderOverrides } from '../app.module';

type RuntimeMode = 'memory' | 'real';

export function buildOrchestratorProviderOverridesFromEnv(): OrchestratorProviderOverrides {
  const mode = resolveRuntimeMode(
    process.env.ORCHESTRATOR_RUNTIME_MODE ?? process.env.DOCUMENT_PARSER_RUNTIME_MODE ?? 'memory'
  );

  if (mode === 'memory') {
    const results = new InMemoryProcessingResultRepository();
    return {
      storage: new InMemoryBinaryStorageAdapter(),
      documents: new InMemoryDocumentRepository(),
      jobs: new InMemoryProcessingJobRepository(),
      attempts: new InMemoryJobAttemptRepository(),
      results,
      compatibleResults: results,
      publisher: new InMemoryJobPublisherAdapter(),
      audit: new InMemoryAuditRepository(),
      unitOfWork: new InMemoryUnitOfWork()
    };
  }

  const mongoProvider = new MongoDatabaseProvider(getRequiredEnv('MONGODB_URI'));
  const sessionContext = new MongoSessionContext();
  const results = new MongoProcessingResultRepositoryAdapter(mongoProvider, sessionContext);

  return {
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
    compatibleResults: results,
    publisher: new RabbitMqJobPublisherAdapter(
      getRequiredEnv('RABBITMQ_URL'),
      getRequiredEnv('RABBITMQ_QUEUE_PROCESSING_REQUESTED')
    ),
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
