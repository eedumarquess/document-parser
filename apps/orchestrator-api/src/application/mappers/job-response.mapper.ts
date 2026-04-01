import type { JobResponse } from '../../contracts/http';

export type JobResponseSource = {
  jobId: string;
  documentId: string;
  status: JobResponse['status'];
  requestedMode: string;
  pipelineVersion: string;
  outputVersion: string;
  reusedResult: boolean;
  createdAt: Date;
};

export const toJobResponse = (job: JobResponseSource): JobResponse => ({
  jobId: job.jobId,
  documentId: job.documentId,
  status: job.status,
  requestedMode: job.requestedMode,
  pipelineVersion: job.pipelineVersion,
  outputVersion: job.outputVersion,
  reusedResult: job.reusedResult,
  createdAt: job.createdAt.toISOString()
});
