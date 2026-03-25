import { AttemptStatus, JobStatus, type AuditActor } from '@document-parser/shared-kernel';
import type { JobAttemptRecord, ProcessingJobRecord, ProcessingResultRecord } from '../../contracts/models';

export class ProcessingJobEntity {
  public static createQueued(input: {
    jobId: string;
    documentId: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    requestedBy: AuditActor;
    forceReprocess: boolean;
    status?: JobStatus;
    reprocessOfJobId?: string;
    now: Date;
  }): ProcessingJobRecord {
    return {
      jobId: input.jobId,
      documentId: input.documentId,
      requestedMode: input.requestedMode,
      priority: 'NORMAL',
      queueName: 'document-processing.requested',
      status: input.status ?? JobStatus.QUEUED,
      forceReprocess: input.forceReprocess,
      reusedResult: false,
      reprocessOfJobId: input.reprocessOfJobId,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion,
      acceptedAt: input.now,
      queuedAt: input.now,
      requestedBy: input.requestedBy,
      warnings: [],
      createdAt: input.now,
      updatedAt: input.now
    };
  }

  public static createDeduplicated(input: {
    jobId: string;
    documentId: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    requestedBy: AuditActor;
    compatibleResult: ProcessingResultRecord;
    now: Date;
  }): ProcessingJobRecord {
    return {
      jobId: input.jobId,
      documentId: input.documentId,
      requestedMode: input.requestedMode,
      priority: 'NORMAL',
      queueName: 'document-processing.requested',
      status: input.compatibleResult.status,
      forceReprocess: false,
      reusedResult: true,
      sourceJobId: input.compatibleResult.jobId,
      sourceResultId: input.compatibleResult.resultId,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion,
      acceptedAt: input.now,
      finishedAt: input.now,
      requestedBy: input.requestedBy,
      warnings: input.compatibleResult.warnings,
      createdAt: input.now,
      updatedAt: input.now
    };
  }

  public static createAttempt(input: {
    attemptId: string;
    jobId: string;
    attemptNumber: number;
    pipelineVersion: string;
    now: Date;
  }): JobAttemptRecord {
    return {
      attemptId: input.attemptId,
      jobId: input.jobId,
      attemptNumber: input.attemptNumber,
      pipelineVersion: input.pipelineVersion,
      status: AttemptStatus.QUEUED,
      fallbackUsed: false,
      createdAt: input.now
    };
  }
}

