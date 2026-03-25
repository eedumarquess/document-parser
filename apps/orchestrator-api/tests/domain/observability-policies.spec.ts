import {
  ArtifactType,
  RedactionPolicyService,
  RetentionPolicyService
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
});
