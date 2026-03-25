import {
  AttemptStatus,
  DEFAULT_PRIORITY,
  ErrorCode,
  JobStatus,
  ValidationError,
  type AuditActor,
  type ProcessingOutcome
} from '@document-parser/shared-kernel';
import type {
  DeadLetterRecord,
  IngestionTransitionRecord,
  JobAttemptRecord,
  ProcessingJobRecord,
  ProcessingResultRecord
} from './models';

function createTransition(status: IngestionTransitionRecord['status'], now: Date): IngestionTransitionRecord {
  return {
    status,
    at: now
  };
}

function appendTransition(
  transitions: IngestionTransitionRecord[],
  status: IngestionTransitionRecord['status'],
  now: Date
): IngestionTransitionRecord[] {
  if (transitions.at(-1)?.status === status) {
    return transitions;
  }

  return [...transitions, createTransition(status, now)];
}

function ensureJobStatus(job: ProcessingJobRecord, allowed: JobStatus[], action: string): void {
  if (!allowed.includes(job.status)) {
    throw new ValidationError(`Cannot ${action} when job is ${job.status}`, {
      jobId: job.jobId,
      status: job.status
    });
  }
}

function ensureAttemptStatus(attempt: JobAttemptRecord, allowed: AttemptStatus[], action: string): void {
  if (!allowed.includes(attempt.status)) {
    throw new ValidationError(`Cannot ${action} when attempt is ${attempt.status}`, {
      attemptId: attempt.attemptId,
      status: attempt.status
    });
  }
}

export function createSubmissionJob(input: {
  jobId: string;
  documentId: string;
  requestedMode: string;
  queueName: string;
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
    priority: DEFAULT_PRIORITY,
    queueName: input.queueName,
    status: JobStatus.RECEIVED,
    forceReprocess: input.forceReprocess,
    reusedResult: false,
    pipelineVersion: input.pipelineVersion,
    outputVersion: input.outputVersion,
    acceptedAt: input.now,
    requestedBy: input.requestedBy,
    warnings: [],
    ingestionTransitions: [createTransition(JobStatus.RECEIVED, input.now)],
    createdAt: input.now,
    updatedAt: input.now
  };
}

export function createReprocessingJob(input: {
  jobId: string;
  documentId: string;
  requestedMode: string;
  queueName: string;
  pipelineVersion: string;
  outputVersion: string;
  requestedBy: AuditActor;
  reprocessOfJobId?: string;
  now: Date;
}): ProcessingJobRecord {
  const receivedJob = createSubmissionJob({
    jobId: input.jobId,
    documentId: input.documentId,
    requestedMode: input.requestedMode,
    queueName: input.queueName,
    pipelineVersion: input.pipelineVersion,
    outputVersion: input.outputVersion,
    requestedBy: input.requestedBy,
    forceReprocess: true,
    now: input.now
  });

  return {
    ...receivedJob,
    status: JobStatus.REPROCESSED,
    reprocessOfJobId: input.reprocessOfJobId,
    ingestionTransitions: appendTransition(receivedJob.ingestionTransitions, JobStatus.REPROCESSED, input.now)
  };
}

export function markJobAsValidated(input: { job: ProcessingJobRecord; now: Date }): ProcessingJobRecord {
  ensureJobStatus(input.job, [JobStatus.RECEIVED, JobStatus.REPROCESSED], 'mark job as validated');

  return {
    ...input.job,
    status: JobStatus.VALIDATED,
    ingestionTransitions: appendTransition(input.job.ingestionTransitions, JobStatus.VALIDATED, input.now),
    updatedAt: input.now
  };
}

export function markJobAsStored(input: { job: ProcessingJobRecord; now: Date }): ProcessingJobRecord {
  ensureJobStatus(input.job, [JobStatus.VALIDATED], 'mark job as stored');

  return {
    ...input.job,
    status: JobStatus.STORED,
    ingestionTransitions: appendTransition(input.job.ingestionTransitions, JobStatus.STORED, input.now),
    updatedAt: input.now
  };
}

export function markJobAsQueued(input: { job: ProcessingJobRecord; now: Date }): ProcessingJobRecord {
  ensureJobStatus(input.job, [JobStatus.STORED], 'mark job as queued');

  return {
    ...input.job,
    status: JobStatus.QUEUED,
    queuedAt: input.now,
    errorCode: undefined,
    errorMessage: undefined,
    ingestionTransitions: appendTransition(input.job.ingestionTransitions, JobStatus.QUEUED, input.now),
    updatedAt: input.now
  };
}

export function rescheduleJobForRetry(input: { job: ProcessingJobRecord; now: Date }): ProcessingJobRecord {
  ensureJobStatus(input.job, [JobStatus.PROCESSING], 'reschedule job for retry');

  return {
    ...input.job,
    status: JobStatus.QUEUED,
    errorCode: undefined,
    errorMessage: undefined,
    updatedAt: input.now
  };
}

export function createDeduplicatedJob(input: {
  jobId: string;
  documentId: string;
  requestedMode: string;
  queueName: string;
  pipelineVersion: string;
  outputVersion: string;
  requestedBy: AuditActor;
  compatibleResult: ProcessingResultRecord;
  now: Date;
}): ProcessingJobRecord {
  const storedJob = markJobAsStored({
    job: markJobAsValidated({
      job: createSubmissionJob({
        jobId: input.jobId,
        documentId: input.documentId,
        requestedMode: input.requestedMode,
        queueName: input.queueName,
        pipelineVersion: input.pipelineVersion,
        outputVersion: input.outputVersion,
        requestedBy: input.requestedBy,
        forceReprocess: false,
        now: input.now
      }),
      now: input.now
    }),
    now: input.now
  });

  return {
    ...storedJob,
    status: input.compatibleResult.status,
    reusedResult: true,
    sourceJobId: input.compatibleResult.sourceJobId ?? input.compatibleResult.jobId,
    sourceResultId: input.compatibleResult.resultId,
    warnings: input.compatibleResult.warnings,
    finishedAt: input.now,
    ingestionTransitions: appendTransition(storedJob.ingestionTransitions, JobStatus.DEDUPLICATED, input.now),
    updatedAt: input.now
  };
}

export function recordJobError(input: {
  job: ProcessingJobRecord;
  errorCode: ErrorCode;
  errorMessage: string;
  now: Date;
  status?: JobStatus;
}): ProcessingJobRecord {
  return {
    ...input.job,
    status: input.status ?? input.job.status,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    finishedAt:
      input.status === JobStatus.FAILED || input.job.status === JobStatus.FAILED ? input.now : input.job.finishedAt,
    updatedAt: input.now
  };
}

export function createPendingAttempt(input: {
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
    status: AttemptStatus.PENDING,
    fallbackUsed: false,
    createdAt: input.now
  };
}

export function markAttemptAsQueued(input: { attempt: JobAttemptRecord }): JobAttemptRecord {
  ensureAttemptStatus(input.attempt, [AttemptStatus.PENDING], 'mark attempt as queued');

  return {
    ...input.attempt,
    status: AttemptStatus.QUEUED
  };
}

export function startPendingAttempt(input: {
  job: ProcessingJobRecord;
  attempt: JobAttemptRecord;
  now: Date;
}): { job: ProcessingJobRecord; attempt: JobAttemptRecord } {
  ensureJobStatus(input.job, [JobStatus.QUEUED], 'start attempt');
  ensureAttemptStatus(input.attempt, [AttemptStatus.PENDING, AttemptStatus.QUEUED], 'start attempt');

  return {
    job: {
      ...input.job,
      status: JobStatus.PROCESSING,
      startedAt: input.now,
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: input.now
    },
    attempt: {
      ...input.attempt,
      status: AttemptStatus.PROCESSING,
      startedAt: input.now,
      errorCode: undefined,
      errorDetails: undefined
    }
  };
}

export function completeAttemptWithOutcome(input: {
  job: ProcessingJobRecord;
  attempt: JobAttemptRecord;
  outcome: ProcessingOutcome;
  now: Date;
}): { job: ProcessingJobRecord; attempt: JobAttemptRecord } {
  ensureJobStatus(input.job, [JobStatus.PROCESSING], 'complete attempt');
  ensureAttemptStatus(input.attempt, [AttemptStatus.PROCESSING], 'complete attempt');

  const attemptStatus = input.outcome.status === JobStatus.PARTIAL ? AttemptStatus.PARTIAL : AttemptStatus.COMPLETED;

  return {
    job: {
      ...input.job,
      status: input.outcome.status,
      warnings: input.outcome.warnings,
      finishedAt: input.now,
      updatedAt: input.now
    },
    attempt: {
      ...input.attempt,
      status: attemptStatus,
      fallbackUsed: input.outcome.fallbackUsed,
      fallbackReason: input.outcome.fallbackUsed ? 'PIPELINE_FALLBACK_TRIGGERED' : undefined,
      normalizationVersion: input.outcome.normalizationVersion,
      promptVersion: input.outcome.promptVersion,
      modelVersion: input.outcome.modelVersion,
      latencyMs: input.outcome.totalLatencyMs,
      finishedAt: input.now
    }
  };
}

export function failAttempt(input: {
  attempt: JobAttemptRecord;
  errorCode: ErrorCode.TRANSIENT_FAILURE | ErrorCode.FATAL_FAILURE | ErrorCode.TIMEOUT;
  errorDetails: Record<string, unknown>;
  now: Date;
}): JobAttemptRecord {
  ensureAttemptStatus(input.attempt, [AttemptStatus.PROCESSING], 'fail attempt');

  return {
    ...input.attempt,
    status: input.errorCode === ErrorCode.TIMEOUT ? AttemptStatus.TIMED_OUT : AttemptStatus.FAILED,
    finishedAt: input.now,
    errorCode: input.errorCode,
    errorDetails: input.errorDetails
  };
}

export function moveFailedAttemptToDeadLetter(input: {
  job: ProcessingJobRecord;
  attempt: JobAttemptRecord;
  queueName: string;
  reasonCode: ErrorCode.DLQ_ERROR | ErrorCode.FATAL_FAILURE | ErrorCode.TIMEOUT;
  reasonMessage: string;
  payloadSnapshot: Record<string, unknown>;
  deadLetterEventId: string;
  now: Date;
}): { job: ProcessingJobRecord; attempt: JobAttemptRecord; deadLetter: DeadLetterRecord } {
  ensureAttemptStatus(
    input.attempt,
    [AttemptStatus.FAILED, AttemptStatus.TIMED_OUT, AttemptStatus.PENDING, AttemptStatus.QUEUED],
    'move attempt to dead letter'
  );

  return {
    job: {
      ...input.job,
      status: JobStatus.FAILED,
      errorCode: input.reasonCode,
      errorMessage: input.reasonMessage,
      finishedAt: input.now,
      updatedAt: input.now
    },
    attempt: {
      ...input.attempt,
      status: AttemptStatus.MOVED_TO_DLQ,
      finishedAt: input.now,
      errorCode: input.reasonCode,
      errorDetails: {
        ...(input.attempt.errorDetails ?? {}),
        movedToDlqAt: input.now.toISOString(),
        reasonMessage: input.reasonMessage
      }
    },
    deadLetter: {
      dlqEventId: input.deadLetterEventId,
      jobId: input.job.jobId,
      attemptId: input.attempt.attemptId,
      queueName: input.queueName,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      retryCount: input.attempt.attemptNumber,
      payloadSnapshot: input.payloadSnapshot,
      firstSeenAt: input.now,
      lastSeenAt: input.now
    }
  };
}
