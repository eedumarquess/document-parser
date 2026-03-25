import { AttemptStatus, FallbackReason, JobStatus, Role } from '@document-parser/shared-kernel';
import { createDefaultExtractionPipeline } from '../../src/adapters/out/extraction/default-extraction.factory';
import { ProcessingOutcomePolicy } from '../../src/domain/policies/processing-outcome.policy';

const baseInput = {
  actor: { actorId: 'owner-1', role: Role.OWNER },
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

describe('OCR/LLM extraction golden dataset', () => {
  const pipeline = createDefaultExtractionPipeline(new ProcessingOutcomePolicy());

  it.each([
    {
      name: 'handwriting fallback',
      original: 'Consulta: [[HANDWRITING:Dor ha 2 dias]]',
      expectedStatus: JobStatus.COMPLETED,
      expectedPayload: 'Consulta: [manuscrito] Dor ha * dias',
      expectedFallbackReason: FallbackReason.HANDWRITING_DETECTED
    },
    {
      name: 'ambiguous checkbox fallback',
      original: 'Paciente [[AMBIGUOUS_CHECKBOX:febre:checked]]',
      expectedStatus: JobStatus.COMPLETED,
      expectedPayload: 'Paciente febre: [marcado]',
      expectedFallbackReason: FallbackReason.CHECKBOX_AMBIGUOUS
    },
    {
      name: 'simple table-like text with illegible fragment',
      original: 'Tabela simples resultado [[ILLEGIBLE]]',
      expectedStatus: JobStatus.PARTIAL,
      expectedPayload: 'Tabela simples resultado [ilegivel]',
      expectedFallbackReason: undefined
    }
  ])('produces stable output for $name', async ({ original, expectedStatus, expectedPayload, expectedFallbackReason }) => {
    const outcome = await pipeline.extract({
      ...baseInput,
      original: Buffer.from(original)
    });

    expect(outcome.status).toBe(expectedStatus);
    expect(outcome.payload).toBe(expectedPayload);
    expect(outcome.fallbackReason).toBe(expectedFallbackReason);
  });
});
