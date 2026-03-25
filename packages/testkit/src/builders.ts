import {
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  JobStatus,
  Role,
  type AuditActor,
  type ProcessingJobRequestedMessage
} from '@document-parser/shared-kernel';

export type UploadedFileFixture = {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};

export const buildUploadedFile = (overrides: Partial<UploadedFileFixture> = {}): UploadedFileFixture => {
  const buffer = overrides.buffer ?? Buffer.from('sample document text');
  return {
    originalName: overrides.originalName ?? 'sample.pdf',
    mimeType: overrides.mimeType ?? 'application/pdf',
    size: overrides.size ?? buffer.byteLength,
    buffer
  };
};

export const buildActor = (overrides: Partial<AuditActor> = {}): AuditActor => ({
  actorId: overrides.actorId ?? 'owner-1',
  role: overrides.role ?? Role.OWNER
});

export const buildJobMessage = (
  overrides: Partial<ProcessingJobRequestedMessage> = {}
): ProcessingJobRequestedMessage => ({
  documentId: overrides.documentId ?? 'doc-1',
  jobId: overrides.jobId ?? 'job-1',
  attemptId: overrides.attemptId ?? 'attempt-1',
  requestedMode: overrides.requestedMode ?? 'STANDARD',
  pipelineVersion: overrides.pipelineVersion ?? DEFAULT_PIPELINE_VERSION,
  publishedAt: overrides.publishedAt ?? new Date('2026-03-25T12:00:00.000Z').toISOString()
});

export const buildResultSummary = (overrides: Partial<Record<string, unknown>> = {}) => ({
  jobId: overrides.jobId ?? 'job-1',
  documentId: overrides.documentId ?? 'doc-1',
  status: overrides.status ?? JobStatus.COMPLETED,
  pipelineVersion: overrides.pipelineVersion ?? DEFAULT_PIPELINE_VERSION,
  outputVersion: overrides.outputVersion ?? DEFAULT_OUTPUT_VERSION,
  confidence: overrides.confidence ?? 0.98,
  warnings: overrides.warnings ?? [],
  payload: overrides.payload ?? 'texto consolidado'
});

