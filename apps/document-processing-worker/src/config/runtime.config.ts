import type { BinaryStoragePort, JobPublisherPort } from '../contracts/ports';
import {
  MongoAuditRepositoryAdapter,
  MongoDeadLetterRepositoryAdapter,
  MongoDocumentRepositoryAdapter,
  MongoJobAttemptRepositoryAdapter,
  MongoPageArtifactRepositoryAdapter,
  MongoProcessingJobRepositoryAdapter,
  MongoProcessingResultRepositoryAdapter
} from '../adapters/out/repositories/mongodb.repositories';
import { MongoDatabaseProvider, MongoSessionContext, MongoUnitOfWorkAdapter } from '../adapters/out/repositories/mongodb.provider';
import { MinioBinaryStorageAdapter } from '../adapters/out/storage/minio-binary-storage.adapter';
import { RabbitMqJobPublisherAdapter } from '../adapters/out/queue/rabbitmq-job-publisher.adapter';
import type { WorkerProviderOverrides } from '../app.module';

type RuntimeMode = 'memory' | 'real';

type WorkerRuntimeBootstrap = {
  mode: RuntimeMode;
  queueName?: string;
  rabbitMqUrl?: string;
  overrides: WorkerProviderOverrides;
};

export function buildWorkerRuntimeBootstrapFromEnv(): WorkerRuntimeBootstrap {
  const mode = resolveRuntimeMode(
    process.env.WORKER_RUNTIME_MODE ?? process.env.DOCUMENT_PARSER_RUNTIME_MODE ?? 'memory'
  );

  if (mode === 'memory') {
    return {
      mode,
      overrides: {
        storage: createNoopStorage(),
        publisher: createNoopPublisher()
      }
    };
  }

  const queueName = getRequiredEnv('RABBITMQ_QUEUE_PROCESSING_REQUESTED');
  const rabbitMqUrl = getRequiredEnv('RABBITMQ_URL');
  const mongoProvider = new MongoDatabaseProvider(getRequiredEnv('MONGODB_URI'));
  const sessionContext = new MongoSessionContext();

  return {
    mode,
    queueName,
    rabbitMqUrl,
    overrides: {
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
      audit: new MongoAuditRepositoryAdapter(mongoProvider, sessionContext),
      publisher: new RabbitMqJobPublisherAdapter(rabbitMqUrl, queueName),
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

function resolveRuntimeMode(value: string): RuntimeMode {
  if (value === 'memory' || value === 'real') {
    return value;
  }

  throw new Error(`Unsupported worker runtime mode: ${value}`);
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
