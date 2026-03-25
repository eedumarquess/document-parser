import { AttemptStatus, JobStatus, type AuditActor } from '@document-parser/shared-kernel';
import type {
  IngestionTransitionRecord,
  JobAttemptRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from '../../contracts/models';

export class ProcessingJobEntity {
  public static createStored(input: {
    jobId: string;
    documentId: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    requestedBy: AuditActor;
    forceReprocess: boolean;
    now: Date;
  }): ProcessingJobRecord {
    return {
      jobId: input.jobId,
      documentId: input.documentId,
      requestedMode: input.requestedMode,
      priority: 'NORMAL',
      queueName: 'document-processing.requested',
      status: JobStatus.STORED,
      forceReprocess: input.forceReprocess,
      reusedResult: false,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion,
      acceptedAt: input.now,
      requestedBy: input.requestedBy,
      warnings: [],
      ingestionTransitions: this.createTransitions(
        [JobStatus.RECEIVED, JobStatus.VALIDATED, JobStatus.STORED],
        input.now
      ),
      createdAt: input.now,
      updatedAt: input.now
    };
  }

  public static createReprocessed(input: {
    jobId: string;
    documentId: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    requestedBy: AuditActor;
    now: Date;
    reprocessOfJobId?: string;
    transitions?: IngestionTransitionRecord[];
  }): ProcessingJobRecord {
    return {
      jobId: input.jobId,
      documentId: input.documentId,
      requestedMode: input.requestedMode,
      priority: 'NORMAL',
      queueName: 'document-processing.requested',
      status: JobStatus.REPROCESSED,
      forceReprocess: true,
      reusedResult: false,
      reprocessOfJobId: input.reprocessOfJobId,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion,
      acceptedAt: input.now,
      requestedBy: input.requestedBy,
      warnings: [],
      ingestionTransitions:
        input.transitions ?? this.createTransitions([JobStatus.REPROCESSED], input.now),
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
      sourceJobId: input.compatibleResult.sourceJobId ?? input.compatibleResult.jobId,
      sourceResultId: input.compatibleResult.resultId,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion,
      acceptedAt: input.now,
      finishedAt: input.now,
      requestedBy: input.requestedBy,
      warnings: input.compatibleResult.warnings,
      ingestionTransitions: this.createTransitions(
        [JobStatus.RECEIVED, JobStatus.VALIDATED, JobStatus.STORED, JobStatus.DEDUPLICATED],
        input.now
      ),
      createdAt: input.now,
      updatedAt: input.now
    };
  }

  public static markQueued(input: { job: ProcessingJobRecord; now: Date }): ProcessingJobRecord {
    return {
      ...input.job,
      status: JobStatus.QUEUED,
      queuedAt: input.now,
      errorCode: undefined,
      errorMessage: undefined,
      ingestionTransitions: this.appendTransition(input.job.ingestionTransitions, JobStatus.QUEUED, input.now),
      updatedAt: input.now
    };
  }

  private static createTransitions(
    statuses: Array<
      | JobStatus.RECEIVED
      | JobStatus.VALIDATED
      | JobStatus.STORED
      | JobStatus.DEDUPLICATED
      | JobStatus.REPROCESSED
      | JobStatus.QUEUED
    >,
    now: Date
  ): IngestionTransitionRecord[] {
    return statuses.map((status) => ({
      status,
      at: now
    }));
  }

  private static appendTransition(
    transitions: IngestionTransitionRecord[],
    status: IngestionTransitionRecord['status'],
    now: Date
  ): IngestionTransitionRecord[] {
    if (transitions.at(-1)?.status === status) {
      return transitions;
    }

    return [...transitions, { status, at: now }];
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
