import { createServer } from 'http';
import {
  ArtifactType,
  RedactionPolicyService,
  RetentionPolicyService,
  createOtlpHttpObservabilityAdapters
} from '@document-parser/shared-kernel';

describe('Observability policies', () => {
  const now = new Date('2026-03-25T12:00:00.000Z');

  it('applies the canonical retention windows by collection and artifact type', () => {
    const policy = new RetentionPolicyService();

    expect(policy.calculateOriginalRetentionUntil(now)).toEqual(new Date('2026-04-24T12:00:00.000Z'));
    expect(policy.calculateProcessingResultRetentionUntil(now)).toEqual(new Date('2026-06-23T12:00:00.000Z'));
    expect(policy.calculateAuditRetentionUntil(now)).toEqual(new Date('2026-09-21T12:00:00.000Z'));
    expect(policy.calculateDeadLetterRetentionUntil(now)).toEqual(new Date('2026-09-21T12:00:00.000Z'));
    expect(
      policy.calculatePageArtifactRetentionUntil({
        artifactType: ArtifactType.OCR_JSON,
        now
      })
    ).toEqual(new Date('2026-06-23T12:00:00.000Z'));
    expect(
      policy.calculatePageArtifactRetentionUntil({
        artifactType: ArtifactType.RENDERED_IMAGE,
        now
      })
    ).toEqual(new Date('2026-04-24T12:00:00.000Z'));
  });

  it('redacts payload-like and binary fields recursively', () => {
    const policy = new RedactionPolicyService();

    expect(
      policy.redact({
        traceId: 'trace-1',
        payload: 'texto completo',
        nested: {
          rawPayload: {
            content: 'segredo'
          },
          promptText: 'prompt',
          child: {
            responseText: 'response'
          }
        },
        buffer: Buffer.from('secret'),
        safe: 'ok'
      })
    ).toEqual({
      traceId: 'trace-1',
      payload: '[REDACTED]',
      nested: {
        rawPayload: '[REDACTED]',
        promptText: '[REDACTED]',
        child: {
          responseText: '[REDACTED]'
        }
      },
      buffer: '[REDACTED_BINARY]',
      safe: 'ok'
    });
  });

  it('applies semantic redaction to free-text fields', () => {
    const policy = new RedactionPolicyService();

    expect(
      policy.redact(
        {
          reason: 'cpf 123.456.789-00 email user@example.com tel 11999998888',
          jobId: 'job-1'
        },
        {
          context: 'log'
        }
      )
    ).toEqual({
      reason: 'cpf [cpf] email [email] tel [phone]',
      jobId: 'job-1'
    });
  });

  it('sanitizes audit metadata by collapsing non-operational text', () => {
    const policy = new RedactionPolicyService();

    expect(
      policy.sanitizeMetadata({
        jobId: 'job-1',
        documentId: 'doc-1',
        missingResources: ['document'],
        reason: 'model update',
        errorMessage: 'cpf 123.456.789-00',
        nested: {
          note: 'segredo'
        }
      })
    ).toEqual({
      jobId: 'job-1',
      documentId: 'doc-1',
      missingResources: ['document'],
      reason: '[REDACTED]',
      errorMessage: '[REDACTED]',
      nested: '[REDACTED]'
    });
  });
});

describe('OTLP observability adapters', () => {
  it('exports logs, metrics and traces through OTLP HTTP payloads', async () => {
    const received: Array<{ url: string; body: unknown }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      request.on('end', () => {
        received.push({
          url: request.url ?? '',
          body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
        });
        response.statusCode = 200;
        response.end('ok');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected TCP address from OTLP test server');
    }

    const endpoint = `http://127.0.0.1:${address.port}`;
    const adapters = createOtlpHttpObservabilityAdapters({
      endpoint,
      serviceName: 'document-parser-test'
    });

    await adapters.logging.log({
      level: 'info',
      message: 'hello world',
      context: 'observability-test',
      traceId: 'trace-123',
      data: { jobId: 'job-1' },
      recordedAt: new Date('2026-03-25T12:00:00.000Z')
    });
    await adapters.metrics.increment({
      name: 'test.counter',
      value: 2,
      traceId: 'trace-123',
      tags: { provider: 'openrouter' }
    });
    await adapters.tracing.runInSpan(
      {
        traceId: 'trace-123',
        spanName: 'test.span',
        attributes: { jobId: 'job-1' }
      },
      async () => 'ok'
    );

    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(received.map((entry) => entry.url)).toEqual(
      expect.arrayContaining(['/v1/logs', '/v1/metrics', '/v1/traces'])
    );
    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: '/v1/logs',
          body: expect.objectContaining({
            resourceLogs: expect.arrayContaining([
              expect.objectContaining({
                resource: expect.objectContaining({
                  attributes: expect.arrayContaining([
                    expect.objectContaining({
                      key: 'service.name',
                      value: { stringValue: 'document-parser-test' }
                    })
                  ])
                })
              })
            ])
          })
        }),
        expect.objectContaining({
          url: '/v1/metrics',
          body: expect.objectContaining({
            resourceMetrics: expect.any(Array)
          })
        }),
        expect.objectContaining({
          url: '/v1/traces',
          body: expect.objectContaining({
            resourceSpans: expect.arrayContaining([
              expect.objectContaining({
                scopeSpans: expect.arrayContaining([
                  expect.objectContaining({
                    spans: expect.arrayContaining([
                      expect.objectContaining({
                        name: 'test.span',
                        attributes: expect.arrayContaining([
                          expect.objectContaining({
                            key: 'traceId',
                            value: { stringValue: 'trace-123' }
                          })
                        ])
                      })
                    ])
                  })
                ])
              })
            ])
          })
        })
      ])
    );
  });
});
