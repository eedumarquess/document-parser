import {
  RetryPolicyService,
  completeAttemptWithOutcome,
  createPendingAttempt,
  createSubmissionJob,
  failAttempt,
  markAttemptAsQueued,
  markJobAsQueued,
  markJobAsStored,
  markJobAsValidated,
  moveFailedAttemptToDeadLetter,
  startPendingAttempt
} from '@document-parser/document-processing-domain';
import {
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  DEFAULT_PROCESSING_QUEUE_NAME,
  ErrorCode,
  JobStatus
} from '@document-parser/shared-kernel';
import { buildActor } from '@document-parser/testkit';

describe('Job attempt lifecycle', () => {
  const actor = buildActor();
  const now = new Date('2026-03-25T12:00:00.000Z');

  const createQueuedJob = () =>
    markJobAsQueued({
      job: markJobAsStored({
        job: markJobAsValidated({
          job: createSubmissionJob({
            jobId: 'job-1',
            documentId: 'doc-1',
            requestedMode: 'STANDARD',
            queueName: DEFAULT_PROCESSING_QUEUE_NAME,
            pipelineVersion: DEFAULT_PIPELINE_VERSION,
            outputVersion: DEFAULT_OUTPUT_VERSION,
            requestedBy: actor,
            forceReprocess: false,
            now
          }),
          now
        }),
        now
      }),
      now
    });

  it('walks attempt state from PENDING to PARTIAL and stamps versions', () => {
    const job = createQueuedJob();
    const pending = createPendingAttempt({
      attemptId: 'attempt-1',
      jobId: job.jobId,
      attemptNumber: 1,
      pipelineVersion: job.pipelineVersion,
      now
    });

    const started = startPendingAttempt({
      job,
      attempt: markAttemptAsQueued({ attempt: pending }),
      now
    });
    const completed = completeAttemptWithOutcome({
      job: started.job,
      attempt: started.attempt,
      outcome: {
        status: JobStatus.PARTIAL,
        engineUsed: 'OCR+LLM',
        confidence: 0.62,
        warnings: ['ILLEGIBLE_CONTENT'],
        payload: '[ilegivel]',
        artifacts: [],
        fallbackUsed: true,
        promptVersion: 'git:prompt',
        modelVersion: 'git:model',
        normalizationVersion: 'git:norm',
        totalLatencyMs: 2200
      },
      now
    });

    expect(completed.job.status).toBe(JobStatus.PARTIAL);
    expect(completed.attempt.status).toBe('PARTIAL');
    expect(completed.attempt.promptVersion).toBe('git:prompt');
    expect(completed.attempt.modelVersion).toBe('git:model');
    expect(completed.attempt.normalizationVersion).toBe('git:norm');
  });

  it('moves an exhausted failed attempt to DLQ', () => {
    const job = createQueuedJob();
    const pending = createPendingAttempt({
      attemptId: 'attempt-1',
      jobId: job.jobId,
      attemptNumber: 3,
      pipelineVersion: job.pipelineVersion,
      now
    });
    const started = startPendingAttempt({
      job,
      attempt: markAttemptAsQueued({ attempt: pending }),
      now
    });
    const failed = failAttempt({
      attempt: started.attempt,
      errorCode: ErrorCode.TRANSIENT_FAILURE,
      errorDetails: { message: 'temporary failure' },
      now
    });

    const moved = moveFailedAttemptToDeadLetter({
      job: started.job,
      attempt: failed,
      queueName: DEFAULT_PROCESSING_QUEUE_NAME,
      reasonCode: ErrorCode.DLQ_ERROR,
      reasonMessage: 'retries exhausted',
      payloadSnapshot: { jobId: job.jobId, attemptId: failed.attemptId },
      deadLetterEventId: 'dlq-1',
      now
    });

    expect(moved.job.status).toBe(JobStatus.FAILED);
    expect(moved.attempt.status).toBe('MOVED_TO_DLQ');
    expect(moved.deadLetter.reasonCode).toBe(ErrorCode.DLQ_ERROR);
  });
});

describe('RetryPolicyService', () => {
  const policy = new RetryPolicyService();

  it('retries transient failures until the cap', () => {
    expect(policy.decideRetryAfterAttemptFailure({
      attemptNumber: 1,
      classification: ErrorCode.TRANSIENT_FAILURE
    })).toEqual({
      action: 'retry',
      delayMs: 2000,
      nextAttemptNumber: 2
    });
    expect(policy.decideRetryAfterAttemptFailure({
      attemptNumber: 2,
      classification: ErrorCode.TIMEOUT
    })).toEqual({
      action: 'retry',
      delayMs: 4000,
      nextAttemptNumber: 3
    });
    expect(policy.calculateDelayMs(3)).toBe(8000);
  });

  it('does not retry fatal failures or exhausted attempts', () => {
    expect(policy.decideRetryAfterAttemptFailure({
      attemptNumber: 1,
      classification: ErrorCode.FATAL_FAILURE
    })).toEqual({
      action: 'move_to_dlq',
      reasonCode: ErrorCode.FATAL_FAILURE
    });
    expect(policy.decideRetryAfterAttemptFailure({
      attemptNumber: 3,
      classification: ErrorCode.TRANSIENT_FAILURE
    })).toEqual({
      action: 'move_to_dlq',
      reasonCode: ErrorCode.DLQ_ERROR
    });
  });
});
