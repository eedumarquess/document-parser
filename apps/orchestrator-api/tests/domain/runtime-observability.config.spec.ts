import { RuntimeResourceRegistry } from '@document-parser/shared-infrastructure';
import { buildOrchestratorRuntimeBootstrapFromEnv } from '../../src/config/runtime.config';

describe('orchestrator runtime bootstrap config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('falls back to local adapters when OTLP mode is enabled without endpoint', () => {
    process.env.DOCUMENT_PARSER_RUNTIME_MODE = 'memory';
    process.env.OBSERVABILITY_MODE = 'otlp';
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const bootstrap = buildOrchestratorRuntimeBootstrapFromEnv();

    expect(bootstrap.overrides.logging).toBeUndefined();
    expect(bootstrap.overrides.metrics).toBeUndefined();
    expect(bootstrap.overrides.tracing).toBeUndefined();
    expect(bootstrap.runtimeResources).toBeInstanceOf(RuntimeResourceRegistry);
    expect(warnSpy).toHaveBeenCalledWith(
      'Missing OTEL_EXPORTER_OTLP_ENDPOINT. Falling back to local adapters.'
    );

    warnSpy.mockRestore();
  });

  it('registers closable real runtime resources for graceful shutdown', () => {
    process.env.DOCUMENT_PARSER_RUNTIME_MODE = 'real';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/document-parser';
    process.env.RABBITMQ_URL = 'amqp://guest:guest@localhost:5672';
    process.env.RABBITMQ_QUEUE_PROCESSING_REQUESTED = 'document-processing.requested';
    process.env.MINIO_ENDPOINT = 'localhost';
    process.env.MINIO_PORT = '9000';
    process.env.MINIO_USE_SSL = 'false';
    process.env.MINIO_ACCESS_KEY = 'minio';
    process.env.MINIO_SECRET_KEY = 'minio123';
    process.env.MINIO_BUCKET_ORIGINALS = 'documents';

    const bootstrap = buildOrchestratorRuntimeBootstrapFromEnv();

    expect(bootstrap.mode).toBe('real');
    expect(bootstrap.overrides.publisher).toBeDefined();
    expect(bootstrap.overrides.unitOfWork).toBeDefined();
    expect(bootstrap.runtimeResources).toBeInstanceOf(RuntimeResourceRegistry);
  });
});
