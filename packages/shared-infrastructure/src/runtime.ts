import {
  createOtlpHttpObservabilityAdapters,
  parseOtlpHeaders
} from '@document-parser/shared-kernel';
import { MongoDatabaseProvider } from './mongodb';
import { RabbitMqJobPublisherAdapter } from './rabbitmq-job-publisher.adapter';

export type RuntimeMode = 'memory' | 'real';

export type ClosableResource = {
  close(): Promise<void> | void;
};

export type ObservabilityOverrides = Partial<ReturnType<typeof createOtlpHttpObservabilityAdapters>>;

export class RuntimeResourceRegistry {
  private readonly resources: ClosableResource[] = [];
  private closeAllPromise?: Promise<void>;

  public register<T extends ClosableResource>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }

  public async closeAll(): Promise<void> {
    if (this.closeAllPromise !== undefined) {
      await this.closeAllPromise;
      return;
    }

    this.closeAllPromise = (async () => {
      const resources = [...this.resources].reverse();
      this.resources.length = 0;

      for (const resource of resources) {
        await resource.close();
      }
    })();

    await this.closeAllPromise;
  }
}

export function resolveRuntimeMode(value: string, context: string): RuntimeMode {
  if (value === 'memory' || value === 'real') {
    return value;
  }

  throw new Error(`Unsupported ${context} runtime mode: ${value}`);
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function parseNumberEnv(name: string): number {
  const value = Number(getRequiredEnv(name));
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return value;
}

export function parseBooleanEnv(name: string): boolean {
  const value = getRequiredEnv(name).toLowerCase();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  throw new Error(`Environment variable ${name} must be "true" or "false"`);
}

export function parseOptionalNumberEnv(name: string, defaultValue: number): number {
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

export function buildObservabilityOverrides(defaultServiceName: string): ObservabilityOverrides {
  const mode = (process.env.OBSERVABILITY_MODE ?? 'local').trim().toLowerCase();
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || defaultServiceName;

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
    serviceName,
    headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS)
  });
}

export function createRegisteredMongoDatabaseProvider(
  uri: string,
  runtimeResources: RuntimeResourceRegistry
): MongoDatabaseProvider {
  return runtimeResources.register(new MongoDatabaseProvider(uri));
}

export function createRegisteredRabbitMqJobPublisher(
  url: string,
  queueName: string,
  runtimeResources: RuntimeResourceRegistry
): RabbitMqJobPublisherAdapter {
  return runtimeResources.register(new RabbitMqJobPublisherAdapter(url, queueName));
}
