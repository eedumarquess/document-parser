import { JobStatus, MAX_FILE_SIZE_BYTES } from '@document-parser/shared-kernel';
import { DocumentAcceptancePolicy } from '../../src/domain/policies/document-acceptance.policy';
import { CompatibilityKey } from '../../src/domain/value-objects/compatibility-key';
import { CompatibleResultReusePolicy } from '../../src/domain/policies/compatible-result-reuse.policy';

describe('DocumentAcceptancePolicy', () => {
  const policy = new DocumentAcceptancePolicy();

  it.each(['application/pdf', 'image/jpeg', 'image/png'])('accepts %s', (mimeType) => {
    expect(() =>
      policy.validate({
        mimeType,
        fileSizeBytes: 1024,
        pageCount: 1
      })
    ).not.toThrow();
  });

  it('rejects unsupported MIME type', () => {
    expect(() =>
      policy.validate({
        mimeType: 'text/plain',
        fileSizeBytes: 100,
        pageCount: 1
      })
    ).toThrow('Unsupported MIME type');
  });

  it('rejects files larger than 50 MB', () => {
    expect(() =>
      policy.validate({
        mimeType: 'application/pdf',
        fileSizeBytes: MAX_FILE_SIZE_BYTES + 1,
        pageCount: 1
      })
    ).toThrow('File exceeds 50 MB limit');
  });

  it('rejects documents with more than 10 pages', () => {
    expect(() =>
      policy.validate({
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        pageCount: 11
      })
    ).toThrow('Document exceeds 10 page limit');
  });
});

describe('CompatibilityKey', () => {
  it('composes the official compatibility key', () => {
    expect(
      CompatibilityKey.build({
        hash: 'sha256:abc',
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        outputVersion: '1.0.0'
      })
    ).toBe('sha256:abc:STANDARD:git-sha:1.0.0');
  });

  it('ignores unrelated template-like metadata at runtime', () => {
    const input: {
      hash: string;
      requestedMode: string;
      pipelineVersion: string;
      outputVersion: string;
      templateId?: string;
      templateVersion?: string;
    } = {
      hash: 'sha256:abc',
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      outputVersion: '1.0.0',
      templateId: 'template-legacy',
      templateVersion: 'v3'
    };

    expect(
      CompatibilityKey.build(input)
    ).toBe('sha256:abc:STANDARD:git-sha:1.0.0');
  });
});

describe('CompatibleResultReusePolicy', () => {
  const policy = new CompatibleResultReusePolicy();

  it('reuses a compatible result when reprocess is not forced', () => {
    expect(
      policy.shouldReuse({
        compatibleResult: {
          resultId: 'result-1',
          jobId: 'job-1',
          documentId: 'doc-1',
          compatibilityKey: 'sha256:doc:STANDARD:git-sha:1.0.0',
          status: JobStatus.COMPLETED,
          requestedMode: 'STANDARD',
          pipelineVersion: 'git-sha',
          outputVersion: '1.0.0',
          confidence: 0.98,
          warnings: [],
          payload: 'payload',
          engineUsed: 'OCR',
          totalLatencyMs: 1000,
          createdAt: new Date(),
          updatedAt: new Date(),
          retentionUntil: new Date('2026-06-23T12:00:00.000Z')
        },
        forceReprocess: false
      })
    ).toBe(true);
  });

  it('ignores compatible results when reprocess is forced', () => {
    expect(
      policy.shouldReuse({
        compatibleResult: {
          resultId: 'result-1',
          jobId: 'job-1',
          documentId: 'doc-1',
          compatibilityKey: 'sha256:doc:STANDARD:git-sha:1.0.0',
          status: JobStatus.COMPLETED,
          requestedMode: 'STANDARD',
          pipelineVersion: 'git-sha',
          outputVersion: '1.0.0',
          confidence: 0.98,
          warnings: [],
          payload: 'payload',
          engineUsed: 'OCR',
          totalLatencyMs: 1000,
          createdAt: new Date(),
          updatedAt: new Date(),
          retentionUntil: new Date('2026-06-23T12:00:00.000Z')
        },
        forceReprocess: true
      })
    ).toBe(false);
  });

  it('does not reuse when there is no compatible result', () => {
    expect(
      policy.shouldReuse({
        compatibleResult: undefined,
        forceReprocess: false
      })
    ).toBe(false);
  });
});
