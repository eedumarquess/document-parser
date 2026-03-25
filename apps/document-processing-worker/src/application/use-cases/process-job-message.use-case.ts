import { Inject, Injectable } from '@nestjs/common';
import {
  buildFailureMessage,
  classifyAttemptFailure,
  completeAttemptWithOutcome,
  createPendingAttempt,
  failAttempt,
  markAttemptAsQueued,
  moveFailedAttemptToDeadLetter,
  recordJobError,
  rescheduleJobForRetry,
  startPendingAttempt,
  type JobAttemptRecord,
  type ProcessingJobRecord
} from '@document-parser/document-processing-domain';
import {
  ErrorCode,
  FatalFailureError,
  JobStatus,
  Role,
  type AuditActor,
  type ProcessingJobRequestedMessage
} from '@document-parser/shared-kernel';
import { ProcessingResultEntity } from '../../domain/entities/processing-result.entity';
import { RetryPolicyService } from '../../domain/policies/retry-policy.service';
import type {
  AuditPort,
  BinaryStoragePort,
  ClockPort,
  DeadLetterRepositoryPort,
  DocumentRepositoryPort,
  ExtractionPipelinePort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type { ProcessJobMessageCommand } from '../commands/process-job-message.command';

class MessageMovedToDeadLetterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MessageMovedToDeadLetterError';
  }
}

@Injectable()
export class ProcessJobMessageUseCase {
  private readonly systemActor: AuditActor = {
    actorId: 'document-processing-worker',
    role: Role.OWNER
  };

  public constructor(
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.STORAGE) private readonly storage: BinaryStoragePort,
    @Inject(TOKENS.DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.RESULT_REPOSITORY) private readonly results: ProcessingResultRepositoryPort,
    @Inject(TOKENS.PAGE_ARTIFACT_REPOSITORY) private readonly artifacts: PageArtifactRepositoryPort,
    @Inject(TOKENS.DEAD_LETTER_REPOSITORY) private readonly deadLetters: DeadLetterRepositoryPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort,
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TOKENS.EXTRACTION_PIPELINE) private readonly extraction: ExtractionPipelinePort,
    private readonly retryPolicy: RetryPolicyService
  ) {}

  public async execute(command: ProcessJobMessageCommand): Promise<void> {
    const { message } = command;
    const now = this.clock.now();
    const job = await this.jobs.findById(message.jobId);
    const document = await this.documents.findById(message.documentId);
    const attempt = await this.attempts.findById(message.attemptId);

    if (job === undefined || document === undefined || attempt === undefined) {
      throw new FatalFailureError('Worker context is incomplete', {
        jobId: message.jobId,
        documentId: message.documentId,
        attemptId: message.attemptId
      });
    }

    const started = startPendingAttempt({
      job,
      attempt,
      now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(started.job);
      await this.attempts.save(started.attempt);
    });

    try {
      const original = await this.storage.read(document.storageReference);
      const outcome = await this.extraction.extract({
        actor: job.requestedBy,
        document,
        job: started.job,
        attempt: started.attempt,
        original
      });

      const completed = completeAttemptWithOutcome({
        job: started.job,
        attempt: started.attempt,
        outcome,
        now
      });

      await this.unitOfWork.runInTransaction(async () => {
        await this.artifacts.saveMany(
          outcome.artifacts.map((artifact) => ({
            ...artifact,
            documentId: document.documentId,
            jobId: job.jobId,
            createdAt: now
          }))
        );

        await this.results.save(
          ProcessingResultEntity.create({
            resultId: this.idGenerator.next('result'),
            jobId: job.jobId,
            documentId: document.documentId,
            hash: document.hash,
            requestedMode: job.requestedMode,
            pipelineVersion: job.pipelineVersion,
            outputVersion: job.outputVersion,
            outcome,
            now
          })
        );

        await this.attempts.save(completed.attempt);
        await this.jobs.save(completed.job);
        await this.audit.record({
          eventId: this.idGenerator.next('audit'),
          eventType: 'PROCESSING_COMPLETED',
          actor: this.systemActor,
          metadata: {
            jobId: job.jobId,
            attemptId: attempt.attemptId,
            status: outcome.status
          },
          createdAt: now
        });
      });
    } catch (error) {
      await this.handleFailure({
        error,
        message,
        job: started.job,
        attempt: started.attempt,
        now
      });
    }
  }

  private async handleFailure(input: {
    error: unknown;
    message: ProcessingJobRequestedMessage;
    job: ProcessingJobRecord;
    attempt: JobAttemptRecord;
    now: Date;
  }): Promise<void> {
    const classification = classifyAttemptFailure(input.error);
    const failedAttempt = failAttempt({
      attempt: input.attempt,
      errorCode: classification,
      errorDetails: {
        message: buildFailureMessage(input.error)
      },
      now: input.now
    });
    const decision = this.retryPolicy.decideRetryAfterAttemptFailure({
      attemptNumber: input.attempt.attemptNumber,
      classification
    });

    if (decision.action === 'retry') {
      const nextAttempt = createPendingAttempt({
        attemptId: this.idGenerator.next('attempt'),
        jobId: input.job.jobId,
        attemptNumber: decision.nextAttemptNumber,
        pipelineVersion: input.job.pipelineVersion,
        now: input.now
      });
      const retryMessage = {
        ...input.message,
        attemptId: nextAttempt.attemptId,
        publishedAt: input.now.toISOString()
      };

      try {
        await this.publisher.publishRetry(retryMessage, input.attempt.attemptNumber);
      } catch (publishError) {
        await this.persistDeadLetter({
          job: recordJobError({
            job: input.job,
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
            jobId: input.job.jobId,
            attemptId: nextAttempt.attemptId,
            documentId: input.job.documentId
          },
          previousAttempts: [failedAttempt],
          now: input.now
        });
        throw new MessageMovedToDeadLetterError(buildFailureMessage(publishError));
      }

      const queuedJob = rescheduleJobForRetry({
        job: input.job,
        now: input.now
      });
      const queuedAttempt = markAttemptAsQueued({
        attempt: nextAttempt
      });

      await this.unitOfWork.runInTransaction(async () => {
        await this.attempts.save(failedAttempt);
        await this.attempts.save(queuedAttempt);
        await this.jobs.save(queuedJob);
        await this.audit.record({
          eventId: this.idGenerator.next('audit'),
          eventType: 'PROCESSING_RETRY_SCHEDULED',
          actor: this.systemActor,
          metadata: {
            jobId: input.job.jobId,
            failedAttemptId: input.attempt.attemptId,
            nextAttemptId: nextAttempt.attemptId,
            retryDelayMs: decision.delayMs
          },
          createdAt: input.now
        });
      });
      return;
    }

    await this.persistDeadLetter({
      job: input.job,
      attempt: failedAttempt,
      reasonCode: decision.reasonCode,
      reasonMessage: buildFailureMessage(input.error),
      payloadSnapshot: {
        jobId: input.job.jobId,
        attemptId: input.attempt.attemptId,
        documentId: input.job.documentId
      },
      now: input.now
    });

    throw new MessageMovedToDeadLetterError(buildFailureMessage(input.error));
  }

  private async persistDeadLetter(input: {
    job: ProcessingJobRecord;
    attempt: JobAttemptRecord;
    reasonCode: ErrorCode.DLQ_ERROR | ErrorCode.FATAL_FAILURE | ErrorCode.TIMEOUT;
    reasonMessage: string;
    payloadSnapshot: Record<string, unknown>;
    previousAttempts?: JobAttemptRecord[];
    now: Date;
  }): Promise<void> {
    const moved = moveFailedAttemptToDeadLetter({
      job: input.job,
      attempt: input.attempt,
      queueName: input.job.queueName,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      payloadSnapshot: input.payloadSnapshot,
      deadLetterEventId: this.idGenerator.next('dlq'),
      now: input.now
    });

    await this.unitOfWork.runInTransaction(async () => {
      for (const previousAttempt of input.previousAttempts ?? []) {
        await this.attempts.save(previousAttempt);
      }
      await this.jobs.save(moved.job);
      await this.attempts.save(moved.attempt);
      await this.deadLetters.save(moved.deadLetter);
      await this.audit.record({
        eventId: this.idGenerator.next('audit'),
        eventType: 'PROCESSING_FAILED',
        actor: this.systemActor,
        metadata: {
          jobId: moved.job.jobId,
          attemptId: moved.attempt.attemptId,
          errorCode: input.reasonCode,
          errorMessage: input.reasonMessage
        },
        createdAt: input.now
      });
    });
  }
}
