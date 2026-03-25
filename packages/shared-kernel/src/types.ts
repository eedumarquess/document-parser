import type { AttemptStatus, JobStatus, Role } from './enums';

export type VersionStamp = {
  pipelineVersion: string;
  outputVersion: string;
  normalizationVersion?: string;
  promptVersion?: string;
  modelVersion?: string;
};

export type AuditActor = {
  actorId: string;
  role: Role;
};

export type ProcessingJobRequestedMessage = {
  documentId: string;
  jobId: string;
  attemptId: string;
  requestedMode: string;
  pipelineVersion: string;
  publishedAt: string;
};

export type JobWarning = string;

export type ArtifactReference = {
  artifactId: string;
  artifactType: string;
  storageBucket: string;
  storageObjectKey: string;
  mimeType: string;
  pageNumber?: number;
  metadata?: Record<string, unknown>;
};

export type ProcessingOutcome = {
  status: JobStatus.COMPLETED | JobStatus.PARTIAL;
  engineUsed: string;
  confidence: number;
  warnings: JobWarning[];
  payload: string;
  artifacts: ArtifactReference[];
  fallbackUsed: boolean;
  promptVersion?: string;
  modelVersion?: string;
  normalizationVersion?: string;
  totalLatencyMs: number;
  attemptStatus?: AttemptStatus;
};
