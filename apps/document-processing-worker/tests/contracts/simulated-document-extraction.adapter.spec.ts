import { AttemptStatus, FatalFailureError, JobStatus, TransientFailureError } from '@document-parser/shared-kernel';
import { buildActor } from '@document-parser/testkit';
import { SimulatedDocumentExtractionAdapter } from '../../src/adapters/out/extraction/simulated-document-extraction.adapter';
import { ProcessingOutcomePolicy } from '../../src/domain/policies/processing-outcome.policy';

describe('SimulatedDocumentExtractionAdapter contract', () => {
  const adapter = new SimulatedDocumentExtractionAdapter(new ProcessingOutcomePolicy());
  const baseInput = {
    actor: buildActor(),
    document: {
      documentId: 'doc-1',
      hash: 'sha256:doc',
      originalFileName: 'sample.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 10,
      pageCount: 1,
      sourceType: 'MULTIPART' as const,
      storageReference: { bucket: 'documents', objectKey: 'original/doc-1/sample.pdf' },
      retentionUntil: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    },
    job: {
      jobId: 'job-1',
      documentId: 'doc-1',
      requestedMode: 'STANDARD',
      priority: 'NORMAL',
      queueName: 'document-processing.requested',
      status: JobStatus.PROCESSING,
      forceReprocess: false,
      reusedResult: false,
      pipelineVersion: 'git-sha',
      outputVersion: '1.0.0',
      acceptedAt: new Date(),
      requestedBy: buildActor(),
      warnings: [],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    attempt: {
      attemptId: 'attempt-1',
      jobId: 'job-1',
      attemptNumber: 1,
      pipelineVersion: 'git-sha',
      status: AttemptStatus.PROCESSING,
      fallbackUsed: false,
      createdAt: new Date()
    }
  };

  it('masks digits in the masked artifact metadata', async () => {
    const outcome = await adapter.extract({
      ...baseInput,
      original: Buffer.from('cpf 123456 [[LLM]]')
    });

    const maskedArtifact = outcome.artifacts.find((artifact) => artifact.artifactType === 'MASKED_TEXT');
    expect(maskedArtifact?.metadata).toEqual({ maskedText: 'cpf ******' });
  });

  it('marks illegible payloads as PARTIAL', async () => {
    const outcome = await adapter.extract({
      ...baseInput,
      original: Buffer.from('[[ILLEGIBLE]]')
    });

    expect(outcome.status).toBe(JobStatus.PARTIAL);
    expect(outcome.payload).toContain('[ilegível]');
  });

  it('raises transient failures using the marker contract', async () => {
    await expect(
      adapter.extract({
        ...baseInput,
        original: Buffer.from('[[TRANSIENT_FAILURE]]')
      })
    ).rejects.toBeInstanceOf(TransientFailureError);
  });

  it('raises fatal failures using the marker contract', async () => {
    await expect(
      adapter.extract({
        ...baseInput,
        original: Buffer.from('[[FATAL_FAILURE]]')
      })
    ).rejects.toBeInstanceOf(FatalFailureError);
  });
});
