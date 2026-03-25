import type { JobStatus } from '@document-parser/shared-kernel';

export type JobResponse = {
  jobId: string;
  documentId: string;
  status: JobStatus;
  requestedMode: string;
  pipelineVersion: string;
  outputVersion: string;
  reusedResult: boolean;
  createdAt: string;
};

export type ResultResponse = {
  jobId: string;
  documentId: string;
  status: JobStatus;
  requestedMode: string;
  pipelineVersion: string;
  outputVersion: string;
  confidence: number;
  warnings: string[];
  payload: string;
};

