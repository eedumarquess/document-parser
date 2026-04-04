import { AttemptStatus, JobStatus, Role, TransientFailureError } from '@document-parser/shared-kernel';
import { OcrLlmExtractionPipelineAdapter } from '../../src/adapters/out/extraction/ocr-llm-extraction.pipeline.adapter';

const baseInput = {
  actor: { actorId: 'owner-1', role: Role.OWNER },
  traceId: 'trace-pipeline-1',
  document: {
    documentId: 'doc-1',
    hash: 'sha256:doc',
    originalFileName: 'sample.bin',
    mimeType: 'application/pdf',
    fileSizeBytes: 22,
    pageCount: 1,
    sourceType: 'MULTIPART' as const,
    storageReference: { bucket: 'documents', objectKey: 'original/doc-1/sample.bin' },
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
    queuedAt: new Date(),
    requestedBy: { actorId: 'owner-1', role: Role.OWNER },
    warnings: [],
    ingestionTransitions: [{ status: JobStatus.QUEUED as const, at: new Date() }],
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

describe('OcrLlmExtractionPipelineAdapter contract', () => {
  it('does not parse native PDF bytes as synthetic transient-failure markers', async () => {
    const pageExtractionStage = {
      extract: jest.fn().mockResolvedValue({
        renderedPages: [],
        pageExtractions: []
      })
    };
    const fallbackResolutionStage = {
      resolve: jest.fn().mockResolvedValue({
        pageExtractions: [],
        fallbackTargets: [],
        fallbackArtifacts: []
      })
    };
    const outcome = { status: JobStatus.COMPLETED, payload: 'ok' };
    const outcomeAssemblyStage = {
      assemble: jest.fn().mockResolvedValue(outcome)
    };
    const adapter = new OcrLlmExtractionPipelineAdapter(
      pageExtractionStage as never,
      fallbackResolutionStage as never,
      outcomeAssemblyStage as never
    );
    const original = Buffer.from('[[TRANSIENT_FAILURE]]');

    await expect(
      adapter.extract({
        ...baseInput,
        original
      })
    ).resolves.toBe(outcome);

    expect(pageExtractionStage.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'application/pdf',
        original
      })
    );
  });

  it('keeps synthetic transient-failure markers for non-native documents', async () => {
    const adapter = new OcrLlmExtractionPipelineAdapter(
      { extract: jest.fn() } as never,
      { resolve: jest.fn() } as never,
      { assemble: jest.fn() } as never
    );

    await expect(
      adapter.extract({
        ...baseInput,
        document: {
          ...baseInput.document,
          mimeType: 'text/plain',
          originalFileName: 'sample.txt'
        },
        original: Buffer.from('[[TRANSIENT_FAILURE]]')
      })
    ).rejects.toBeInstanceOf(TransientFailureError);
  });
});
