import { Inject, Injectable } from '@nestjs/common';
import {
  AttemptStatus,
  ErrorCode,
  FatalFailureError,
  JobStatus,
  Role,
  TransientFailureError,
  type AuditActor,
  type ProcessingJobRequestedMessage
} from '@document-parser/shared-kernel';
import { JobAttemptEntity } from '../../domain/entities/job-attempt.entity';
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
  ProcessingResultRepositoryPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type { ProcessJobMessageCommand } from '../commands/process-job-message.command';

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

    const processingJob = {
      ...job,
      status: JobStatus.PROCESSING,
      startedAt: now,
      updatedAt: now
    };
    const processingAttempt = {
      ...attempt,
      status: AttemptStatus.PROCESSING,
      startedAt: now
    };

    await this.jobs.save(processingJob);
    await this.attempts.save(processingAttempt);

    try {
      const original = await this.storage.read(document.storageReference);
      const outcome = await this.extraction.extract({
        actor: job.requestedBy,
        document,
        job: processingJob,
        attempt: processingAttempt,
        original
      });

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
          requestedMode: job.requestedMode,
          pipelineVersion: job.pipelineVersion,
          outputVersion: job.outputVersion,
          outcome,
          now
        })
      );

      await this.attempts.save({
        ...processingAttempt,
        status: AttemptStatus.COMPLETED,
        fallbackUsed: outcome.fallbackUsed,
        finishedAt: now,
        latencyMs: outcome.totalLatencyMs
      });
      await this.jobs.save({
        ...processingJob,
        status: outcome.status,
        warnings: outcome.warnings,
        finishedAt: now,
        updatedAt: now
      });
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
    } catch (error) {
      await this.handleFailure({
        error,
        message,
        job: processingJob,
        attempt: processingAttempt,
        now
      });
    }
  }

  private async handleFailure(input: {
    error: unknown;
    message: ProcessingJobRequestedMessage;
    job: Awaited<ReturnType<ProcessingJobRepositoryPort['findById']>> extends infer T ? Exclude<T, undefined> : never;
    attempt: Awaited<ReturnType<JobAttemptRepositoryPort['findById']>> extends infer T ? Exclude<T, undefined> : never;
    now: Date;
  }): Promise<void> {
    const isTransient = input.error instanceof TransientFailureError;
    const shouldRetry = isTransient && this.retryPolicy.shouldRetry(input.attempt.attemptNumber);

    await this.attempts.save({
      ...input.attempt,
      status: AttemptStatus.FAILED,
      finishedAt: input.now,
      errorCode: isTransient ? ErrorCode.TRANSIENT_FAILURE : ErrorCode.FATAL_FAILURE,
      errorDetails: {
        message: input.error instanceof Error ? input.error.message : 'Unknown failure'
      }
    });

    if (shouldRetry) {
      const nextAttempt = JobAttemptEntity.createRetry({
        attemptId: this.idGenerator.next('attempt'),
        jobId: input.job.jobId,
        attemptNumber: input.attempt.attemptNumber + 1,
        pipelineVersion: input.job.pipelineVersion,
        now: input.now
      });
      await this.attempts.save(nextAttempt);
      await this.jobs.save({
        ...input.job,
        status: JobStatus.QUEUED,
        updatedAt: input.now
      });
      await this.publisher.publish({
        ...input.message,
        attemptId: nextAttempt.attemptId,
        publishedAt: input.now.toISOString()
      });
      await this.audit.record({
        eventId: this.idGenerator.next('audit'),
        eventType: 'PROCESSING_RETRY_SCHEDULED',
        actor: this.systemActor,
        metadata: {
          jobId: input.job.jobId,
          failedAttemptId: input.attempt.attemptId,
          nextAttemptId: nextAttempt.attemptId,
          retryDelayMs: this.retryPolicy.calculateDelayMs(input.attempt.attemptNumber)
        },
        createdAt: input.now
      });
      return;
    }

    await this.jobs.save({
      ...input.job,
      status: JobStatus.FAILED,
      errorCode: isTransient ? ErrorCode.TRANSIENT_FAILURE : ErrorCode.FATAL_FAILURE,
      errorMessage: input.error instanceof Error ? input.error.message : 'Unknown failure',
      finishedAt: input.now,
      updatedAt: input.now
    });
    await this.deadLetters.save({
      dlqEventId: this.idGenerator.next('dlq'),
      jobId: input.job.jobId,
      attemptId: input.attempt.attemptId,
      reasonCode: isTransient ? ErrorCode.DLQ_ERROR : ErrorCode.FATAL_FAILURE,
      reasonMessage: input.error instanceof Error ? input.error.message : 'Unknown failure',
      retryCount: input.attempt.attemptNumber,
      payloadSnapshot: {
        jobId: input.job.jobId,
        attemptId: input.attempt.attemptId,
        documentId: input.job.documentId
      },
      firstSeenAt: input.now,
      lastSeenAt: input.now
    });
    await this.audit.record({
      eventId: this.idGenerator.next('audit'),
      eventType: 'PROCESSING_FAILED',
      actor: this.systemActor,
      metadata: {
        jobId: input.job.jobId,
        attemptId: input.attempt.attemptId,
        errorMessage: input.error instanceof Error ? input.error.message : 'Unknown failure'
      },
      createdAt: input.now
    });
  }
}
