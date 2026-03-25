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
  DEFAULT_PROCESSING_QUEUE_NAME,
  ErrorCode,
  JobStatus,
  RedactionPolicyService,
  RetentionPolicyService,
  Role,
  type AuditActor,
  type ProcessingJobRequestedMessage
} from '@document-parser/shared-kernel';
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
  LoggingPort,
  MetricsPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  TracingPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { ProcessingResultEntity } from '../../domain/entities/processing-result.entity';
import { RetryPolicyService } from '../../domain/policies/retry-policy.service';
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
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TOKENS.EXTRACTION_PIPELINE) private readonly extraction: ExtractionPipelinePort,
    private readonly retryPolicy: RetryPolicyService,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService
  ) {}

  public async execute(command: ProcessJobMessageCommand): Promise<void> {
    const { message } = command;
    const startedAt = Date.now();

    return this.tracing.runInSpan(
      {
        traceId: message.traceId,
        spanName: 'worker.process_job_message',
        attributes: {
          jobId: message.jobId,
          attemptId: message.attemptId
        }
      },
      async () => {
        const context = await this.resolveMessageContext(message);
        if (context.missingResources.length > 0) {
          const now = this.clock.now();
          await this.handleIncompleteContext({
            message,
            ...context,
            now
          });
          await this.metrics.increment({
            name: 'worker.process_job_message.failed',
            traceId: message.traceId
          });
          await this.logging.log({
            level: 'error',
            message: 'Processing moved to dead letter due to incomplete worker context',
            context: 'ProcessJobMessageUseCase',
            traceId: message.traceId,
            data: this.redactionPolicy.redact({
              jobId: message.jobId,
              attemptId: message.attemptId,
              documentId: message.documentId,
              missingResources: context.missingResources
            }) as Record<string, unknown>,
            recordedAt: this.clock.now()
          });
          throw new MessageMovedToDeadLetterError('Worker context is incomplete');
        }

        const job = context.job as ProcessingJobRecord;
        const document = context.document as NonNullable<Awaited<ReturnType<DocumentRepositoryPort['findById']>>>;
        const attempt = context.attempt as JobAttemptRecord;
        const now = this.clock.now();
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
                createdAt: now,
                retentionUntil: this.retentionPolicy.calculatePageArtifactRetentionUntil({
                  artifactType: artifact.artifactType,
                  now
                })
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
                retentionUntil: this.retentionPolicy.calculateProcessingResultRetentionUntil(now),
                now
              })
            );

            await this.attempts.save(completed.attempt);
            await this.jobs.save(completed.job);
            await this.recordAuditEvent({
              eventType: 'PROCESSING_COMPLETED',
              aggregateType: 'JOB_ATTEMPT',
              aggregateId: completed.attempt.attemptId,
              traceId: message.traceId,
              metadata: {
                jobId: job.jobId,
                attemptId: attempt.attemptId,
                status: outcome.status
              },
              createdAt: now
            });
          });

          await this.logging.log({
            level: 'info',
            message: 'Processing completed successfully',
            context: 'ProcessJobMessageUseCase',
            traceId: message.traceId,
            data: this.redactionPolicy.redact({
              jobId: job.jobId,
              attemptId: attempt.attemptId,
              status: outcome.status
            }) as Record<string, unknown>,
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'worker.process_job_message.succeeded',
            traceId: message.traceId
          });
        } catch (error) {
          try {
            const recovery = await this.handleFailure({
              error,
              message,
              job: started.job,
              attempt: started.attempt,
              now
            });

            if (recovery === 'retry_scheduled') {
              await this.logging.log({
                level: 'warn',
                message: 'Processing failed and retry was scheduled',
                context: 'ProcessJobMessageUseCase',
                traceId: message.traceId,
                data: this.redactionPolicy.redact({
                  jobId: started.job.jobId,
                  attemptId: started.attempt.attemptId
                }) as Record<string, unknown>,
                recordedAt: this.clock.now()
              });
              await this.metrics.increment({
                name: 'worker.process_job_message.retry_scheduled',
                traceId: message.traceId
              });
              return;
            }
          } catch (handledError) {
            await this.metrics.increment({
              name: 'worker.process_job_message.failed',
              traceId: message.traceId
            });
            await this.logging.log({
              level: 'error',
              message: 'Processing moved to dead letter',
              context: 'ProcessJobMessageUseCase',
              traceId: message.traceId,
              data: this.redactionPolicy.redact({
                jobId: started.job.jobId,
                attemptId: started.attempt.attemptId,
                errorMessage: handledError instanceof Error ? handledError.message : 'Unexpected failure'
              }) as Record<string, unknown>,
              recordedAt: this.clock.now()
            });
            throw handledError;
          }
        } finally {
          await this.metrics.recordHistogram({
            name: 'worker.process_job_message.duration_ms',
            value: Date.now() - startedAt,
            traceId: message.traceId
          });
        }
      }
    );
  }

  private async resolveMessageContext(message: ProcessingJobRequestedMessage): Promise<{
    job?: ProcessingJobRecord;
    document?: Awaited<ReturnType<DocumentRepositoryPort['findById']>>;
    attempt?: JobAttemptRecord;
    missingResources: string[];
  }> {
    const [job, document, attempt] = await Promise.all([
      this.jobs.findById(message.jobId),
      this.documents.findById(message.documentId),
      this.attempts.findById(message.attemptId)
    ]);
    const missingResources = [
      job === undefined ? 'job' : undefined,
      document === undefined ? 'document' : undefined,
      attempt === undefined ? 'attempt' : undefined
    ].filter((resource): resource is string => resource !== undefined);

    return {
      job,
      document,
      attempt,
      missingResources
    };
  }

  private async handleFailure(input: {
    error: unknown;
    message: ProcessingJobRequestedMessage;
    job: ProcessingJobRecord;
    attempt: JobAttemptRecord;
    now: Date;
  }): Promise<'retry_scheduled'> {
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
          traceId: input.message.traceId,
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
        await this.recordAuditEvent({
          eventType: 'PROCESSING_RETRY_SCHEDULED',
          aggregateType: 'JOB_ATTEMPT',
          aggregateId: queuedAttempt.attemptId,
          traceId: input.message.traceId,
          metadata: {
            jobId: input.job.jobId,
            failedAttemptId: input.attempt.attemptId,
            nextAttemptId: nextAttempt.attemptId,
            retryDelayMs: decision.delayMs
          },
          createdAt: input.now
        });
      });
      return 'retry_scheduled';
    }

    await this.persistDeadLetter({
      traceId: input.message.traceId,
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

  private async handleIncompleteContext(input: {
    message: ProcessingJobRequestedMessage;
    job?: ProcessingJobRecord;
    attempt?: JobAttemptRecord;
    document?: Awaited<ReturnType<DocumentRepositoryPort['findById']>>;
    missingResources: string[];
    now: Date;
  }): Promise<void> {
    const reasonMessage = 'Worker context is incomplete';
    const payloadSnapshot = {
      jobId: input.message.jobId,
      attemptId: input.message.attemptId,
      documentId: input.message.documentId,
      missingResources: input.missingResources
    };

    if (input.job !== undefined && input.attempt !== undefined) {
      await this.persistDeadLetter({
        traceId: input.message.traceId,
        job: input.job,
        attempt: {
          ...input.attempt,
          errorCode: ErrorCode.FATAL_FAILURE,
          errorDetails: {
            ...(input.attempt.errorDetails ?? {}),
            message: reasonMessage,
            missingResources: input.missingResources
          }
        },
        reasonCode: ErrorCode.FATAL_FAILURE,
        reasonMessage,
        payloadSnapshot,
        auditMetadata: {
          missingResources: input.missingResources
        },
        now: input.now
      });
      return;
    }

    await this.unitOfWork.runInTransaction(async () => {
      await this.deadLetters.save({
        dlqEventId: this.idGenerator.next('dlq'),
        jobId: input.message.jobId,
        attemptId: input.message.attemptId,
        traceId: input.message.traceId,
        queueName: input.job?.queueName ?? DEFAULT_PROCESSING_QUEUE_NAME,
        reasonCode: ErrorCode.FATAL_FAILURE,
        reasonMessage,
        retryCount: input.attempt?.attemptNumber ?? 0,
        payloadSnapshot: this.redactionPolicy.redact(payloadSnapshot) as Record<string, unknown>,
        firstSeenAt: input.now,
        lastSeenAt: input.now,
        retentionUntil: this.retentionPolicy.calculateDeadLetterRetentionUntil(input.now)
      });
      await this.recordAuditEvent({
        eventType: 'PROCESSING_FAILED',
        traceId: input.message.traceId,
        metadata: {
          jobId: input.message.jobId,
          attemptId: input.message.attemptId,
          documentId: input.message.documentId,
          errorCode: ErrorCode.FATAL_FAILURE,
          errorMessage: reasonMessage,
          missingResources: input.missingResources
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
      payloadSnapshot: this.redactionPolicy.redact(input.payloadSnapshot),
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
      await this.recordAuditEvent({
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

  private async recordAuditEvent(input: {
    eventType: string;
    aggregateType?: string;
    aggregateId?: string;
    traceId: string;
    metadata?: Record<string, unknown>;
    redactedPayload?: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void> {
    await this.audit.record({
      eventId: this.idGenerator.next('audit'),
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      traceId: input.traceId,
      actor: this.systemActor,
      metadata: input.metadata,
      redactedPayload:
        input.redactedPayload ??
        (input.metadata === undefined
          ? undefined
          : this.redactionPolicy.redact(input.metadata)),
      createdAt: input.createdAt,
      retentionUntil: this.retentionPolicy.calculateAuditRetentionUntil(input.createdAt)
    });
  }
}
