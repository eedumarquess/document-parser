import { Inject, Injectable } from '@nestjs/common';
import {
  buildFailureMessage,
  classifyAttemptFailure,
  createPendingAttempt,
  failAttempt,
  markAttemptAsQueued,
  moveFailedAttemptToDeadLetter,
  recordJobError,
  rescheduleJobForRetry,
  type JobAttemptRecord,
  type ProcessingJobRecord
} from '@document-parser/document-processing-domain';
import {
  DEFAULT_PROCESSING_QUEUE_NAME,
  ErrorCode,
  JobStatus,
  RedactionPolicyService,
  RetentionPolicyService
} from '@document-parser/shared-kernel';
import type {
  DeadLetterRepositoryPort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  ProcessingJobRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { RetryPolicyService } from '../../domain/policies/retry-policy.service';
import type {
  ProcessingExecutionContext,
  ProcessingMessageContext
} from './processing-execution-context';
import {
  IncompleteProcessingContextError,
  ProcessingContextIntegrityError
} from './processing-context-loader.service';
import { AuditEventRecorder } from './audit-event-recorder.service';

type RecoveryContext = ProcessingMessageContext | ProcessingExecutionContext;

@Injectable()
export class ProcessingFailureRecoveryService {
  public constructor(
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.DEAD_LETTER_REPOSITORY) private readonly deadLetters: DeadLetterRepositoryPort,
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly retryPolicy: RetryPolicyService,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService,
    private readonly auditEventRecorder: AuditEventRecorder
  ) {}

  public async recover(input: {
    error: unknown;
    context?: RecoveryContext;
    now: Date;
  }): Promise<'retry_scheduled'> {
    if (input.error instanceof ProcessingContextIntegrityError) {
      await this.handleContextIntegrityFailure({
        error: input.error,
        now: input.now
      });
      throw input.error;
    }

    if (input.context === undefined) {
      throw toError(input.error);
    }
    const context = input.context;

    const classification = classifyAttemptFailure(input.error);
    const failedAttempt = failAttempt({
      attempt: context.attempt,
      errorCode: classification,
      errorDetails: {
        message: buildFailureMessage(input.error)
      },
      now: input.now
    });
    const decision = this.retryPolicy.decideRetryAfterAttemptFailure({
      attemptNumber: context.attempt.attemptNumber,
      classification
    });

    if (decision.action === 'retry') {
      const nextAttempt = createPendingAttempt({
        attemptId: this.idGenerator.next('attempt'),
        jobId: context.job.jobId,
        attemptNumber: decision.nextAttemptNumber,
        pipelineVersion: context.job.pipelineVersion,
        now: input.now
      });
      const retryMessage = {
        ...context.message,
        attemptId: nextAttempt.attemptId,
        publishedAt: input.now.toISOString()
      };

      try {
        await this.publisher.publishRetry(retryMessage, context.attempt.attemptNumber);
      } catch (publishError) {
        await this.persistDeadLetter({
          traceId: context.message.traceId,
          job: recordJobError({
            job: context.job,
            errorCode: ErrorCode.DLQ_ERROR,
            errorMessage: buildFailureMessage(publishError),
            now: input.now,
            status: JobStatus.FAILED
          }),
          attempt: {
            ...nextAttempt,
            errorCode: ErrorCode.DLQ_ERROR,
            errorDetails: {
              message: buildFailureMessage(publishError),
              retrySourceAttemptId: failedAttempt.attemptId
            }
          },
          reasonCode: ErrorCode.DLQ_ERROR,
          reasonMessage: buildFailureMessage(publishError),
          payloadSnapshot: {
            jobId: context.job.jobId,
            attemptId: nextAttempt.attemptId,
            documentId: context.job.documentId
          },
          previousAttempts: [failedAttempt],
          now: input.now
        });
        throw toError(publishError);
      }

      const queuedJob = rescheduleJobForRetry({
        job: context.job,
        now: input.now
      });
      const queuedAttempt = markAttemptAsQueued({
        attempt: nextAttempt
      });

      await this.unitOfWork.runInTransaction(async () => {
        await this.attempts.save(failedAttempt);
        await this.attempts.save(queuedAttempt);
        await this.jobs.save(queuedJob);
        await this.auditEventRecorder.record({
          eventType: 'PROCESSING_RETRY_SCHEDULED',
          aggregateType: 'JOB_ATTEMPT',
          aggregateId: queuedAttempt.attemptId,
          traceId: context.message.traceId,
          metadata: {
            jobId: context.job.jobId,
            failedAttemptId: context.attempt.attemptId,
            nextAttemptId: nextAttempt.attemptId,
            retryDelayMs: decision.delayMs
          },
          createdAt: input.now
        });
      });

      return 'retry_scheduled';
    }

    await this.persistDeadLetter({
      traceId: context.message.traceId,
      job: context.job,
      attempt: failedAttempt,
      reasonCode: decision.reasonCode,
      reasonMessage: buildFailureMessage(input.error),
      payloadSnapshot: {
        jobId: context.job.jobId,
        attemptId: context.attempt.attemptId,
        documentId: context.job.documentId
      },
      now: input.now
    });

    throw toError(input.error);
  }

  private async handleContextIntegrityFailure(input: {
    error: ProcessingContextIntegrityError;
    now: Date;
  }): Promise<void> {
    const partialContext = input.error.partialContext;
    const trustedJob =
      partialContext.job !== undefined && partialContext.job.jobId === partialContext.message.jobId
        ? partialContext.job
        : undefined;
    const trustedAttempt =
      partialContext.attempt !== undefined &&
      partialContext.attempt.attemptId === partialContext.message.attemptId &&
      partialContext.attempt.jobId === (trustedJob?.jobId ?? partialContext.message.jobId)
        ? partialContext.attempt
        : undefined;
    const reasonMessage = input.error.message;
    const payloadSnapshot = {
      jobId: partialContext.message.jobId,
      attemptId: partialContext.message.attemptId,
      documentId: partialContext.message.documentId,
      contextIssue: input.error.contextIssue,
      missingResources: input.error.missingResources,
      mismatches: input.error.mismatches
    };

    if (
      input.error instanceof IncompleteProcessingContextError &&
      trustedJob !== undefined &&
      trustedAttempt !== undefined &&
      trustedJob.documentId === partialContext.message.documentId &&
      trustedAttempt.jobId === trustedJob.jobId
    ) {
      await this.persistDeadLetter({
        traceId: partialContext.message.traceId,
        job: trustedJob,
        attempt: {
          ...trustedAttempt,
          errorCode: ErrorCode.FATAL_FAILURE,
          errorDetails: {
            ...(trustedAttempt.errorDetails ?? {}),
            message: reasonMessage,
            contextIssue: input.error.contextIssue,
            missingResources: input.error.missingResources,
            mismatches: input.error.mismatches
          }
        },
        reasonCode: ErrorCode.FATAL_FAILURE,
        reasonMessage,
        payloadSnapshot,
        auditMetadata: {
          contextIssue: input.error.contextIssue,
          missingResources: input.error.missingResources,
          mismatches: input.error.mismatches
        },
        now: input.now
      });
      return;
    }

    await this.unitOfWork.runInTransaction(async () => {
      await this.deadLetters.save({
        dlqEventId: this.idGenerator.next('dlq'),
        jobId: partialContext.message.jobId,
        attemptId: partialContext.message.attemptId,
        traceId: partialContext.message.traceId,
        queueName: trustedJob?.queueName ?? DEFAULT_PROCESSING_QUEUE_NAME,
        reasonCode: ErrorCode.FATAL_FAILURE,
        reasonMessage,
        retryCount: trustedAttempt?.attemptNumber ?? 0,
        payloadSnapshot: this.redactionPolicy.redact(payloadSnapshot, {
          context: 'dead_letter'
        }) as Record<string, unknown>,
        firstSeenAt: input.now,
        lastSeenAt: input.now,
        retentionUntil: this.retentionPolicy.calculateDeadLetterRetentionUntil(input.now)
      });
      await this.auditEventRecorder.record({
        eventType: 'PROCESSING_FAILED',
        traceId: partialContext.message.traceId,
        metadata: {
          jobId: partialContext.message.jobId,
          attemptId: partialContext.message.attemptId,
          documentId: partialContext.message.documentId,
          errorCode: ErrorCode.FATAL_FAILURE,
          errorMessage: reasonMessage,
          contextIssue: input.error.contextIssue,
          missingResources: input.error.missingResources,
          mismatches: input.error.mismatches
        },
        createdAt: input.now
      });
    });
  }

  private async persistDeadLetter(input: {
    traceId: string;
    job: ProcessingJobRecord;
    attempt: JobAttemptRecord;
    reasonCode: ErrorCode.DLQ_ERROR | ErrorCode.FATAL_FAILURE | ErrorCode.TIMEOUT;
    reasonMessage: string;
    payloadSnapshot: Record<string, unknown>;
    auditMetadata?: Record<string, unknown>;
    previousAttempts?: JobAttemptRecord[];
    now: Date;
  }): Promise<void> {
    const moved = moveFailedAttemptToDeadLetter({
      job: input.job,
      attempt: input.attempt,
      traceId: input.traceId,
      queueName: input.job.queueName,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      payloadSnapshot: this.redactionPolicy.redact(input.payloadSnapshot, {
        context: 'dead_letter'
      }),
      deadLetterEventId: this.idGenerator.next('dlq'),
      retentionUntil: this.retentionPolicy.calculateDeadLetterRetentionUntil(input.now),
      now: input.now
    });

    await this.unitOfWork.runInTransaction(async () => {
      for (const previousAttempt of input.previousAttempts ?? []) {
        await this.attempts.save(previousAttempt);
      }
      await this.jobs.save(moved.job);
      await this.attempts.save(moved.attempt);
      await this.deadLetters.save(moved.deadLetter);
      await this.auditEventRecorder.record({
        eventType: 'PROCESSING_FAILED',
        aggregateType: 'JOB_ATTEMPT',
        aggregateId: moved.attempt.attemptId,
        traceId: input.traceId,
        metadata: {
          jobId: moved.job.jobId,
          attemptId: moved.attempt.attemptId,
          errorCode: input.reasonCode,
          errorMessage: input.reasonMessage,
          ...(input.auditMetadata ?? {})
        },
        createdAt: input.now
      });
    });
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(buildFailureMessage(error));
}
