import { buildOrchestratorProviderOverridesFromEnv } from '../../src/config/runtime.config';

describe('orchestrator runtime observability config', () => {
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

    const overrides = buildOrchestratorProviderOverridesFromEnv();

    expect(overrides.logging).toBeUndefined();
    expect(overrides.metrics).toBeUndefined();
    expect(overrides.tracing).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'Missing OTEL_EXPORTER_OTLP_ENDPOINT. Falling back to local adapters.'
    );

    warnSpy.mockRestore();
  });
});
