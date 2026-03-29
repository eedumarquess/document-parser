import { Inject, Injectable } from '@nestjs/common';
import { RedactionPolicyService } from '@document-parser/shared-kernel';
import type { ClockPort, LoggingPort, MetricsPort, TracingPort } from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type { ProcessJobMessageCommand } from '../commands/process-job-message.command';
import type { ProcessingMessageContext } from '../services/processing-execution-context';
import {
  AttemptExecutionCoordinator,
  DuplicateProcessingMessageIgnoredError
} from '../services/attempt-execution-coordinator.service';
import {
  ProcessingContextIntegrityError,
  ProcessingContextLoader
} from '../services/processing-context-loader.service';
import { ProcessingFailureRecoveryService } from '../services/processing-failure-recovery.service';
import { ProcessingSuccessPersister } from '../services/processing-success-persister.service';

@Injectable()
export class ProcessJobMessageUseCase {
  public constructor(
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    private readonly redactionPolicy: RedactionPolicyService,
    private readonly contextLoader: ProcessingContextLoader,
    private readonly attemptExecutionCoordinator: AttemptExecutionCoordinator,
    private readonly successPersister: ProcessingSuccessPersister,
    private readonly failureRecovery: ProcessingFailureRecoveryService
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
        let context: ProcessingMessageContext | undefined;

        try {
          const loadedContext = await this.runStage(
            {
              traceId: message.traceId,
              jobId: message.jobId,
              documentId: message.documentId,
              attemptId: message.attemptId,
              operation: 'context_load',
              spanName: 'worker.context_load'
            },
            () => this.contextLoader.load(message)
          );
          context = loadedContext;
          const startedContext = await this.runStage(
            {
              traceId: message.traceId,
              jobId: loadedContext.job.jobId,
              documentId: loadedContext.document.documentId,
              attemptId: loadedContext.attempt.attemptId,
              operation: 'attempt_start',
              spanName: 'worker.attempt_start'
            },
            () => this.attemptExecutionCoordinator.start(loadedContext, this.clock.now())
          );
          context = startedContext;
          const execution = await this.runStage(
            {
              traceId: message.traceId,
              jobId: startedContext.job.jobId,
              documentId: startedContext.document.documentId,
              attemptId: startedContext.attempt.attemptId,
              operation: 'extraction',
              spanName: 'worker.extraction'
            },
            () => this.attemptExecutionCoordinator.execute(startedContext)
          );
          const completedAt = this.clock.now();

          await this.runStage(
            {
              traceId: message.traceId,
              jobId: execution.context.job.jobId,
              documentId: execution.context.document.documentId,
              attemptId: execution.context.attempt.attemptId,
              operation: 'success_persist',
              spanName: 'worker.success_persist'
            },
            () =>
              this.successPersister.persist({
                context: execution.context,
                outcome: execution.outcome,
                now: completedAt
              })
          );

          await this.logging.log({
            level: 'info',
            message: 'Processing completed successfully',
            context: 'ProcessJobMessageUseCase',
            traceId: message.traceId,
            data: this.redactionPolicy.redact(
              {
                jobId: execution.context.job.jobId,
                attemptId: execution.context.attempt.attemptId,
                documentId: execution.context.document.documentId,
                operation: 'process_job_message',
                status: execution.outcome.status
              },
              {
                context: 'log'
              }
            ) as Record<string, unknown>,
            recordedAt: completedAt
          });
          await this.metrics.increment({
            name: 'worker.process_job_message.succeeded',
            traceId: message.traceId,
            tags: this.buildTags({
              jobId: execution.context.job.jobId,
              documentId: execution.context.document.documentId,
              attemptId: execution.context.attempt.attemptId,
              operation: 'process_job_message'
            })
          });
        } catch (error) {
          if (error instanceof DuplicateProcessingMessageIgnoredError) {
            await this.metrics.increment({
              name: 'worker.queue_publication_outbox.duplicate_skipped',
              traceId: message.traceId,
              tags: this.buildTags({
                jobId: error.metadata.jobId,
                documentId: error.metadata.documentId,
                attemptId: error.metadata.attemptId,
                operation: 'process_job_message'
              })
            });
            await this.logging.log({
              level: 'warn',
              message: 'Processing message ignored because the job or attempt already advanced',
              context: 'ProcessJobMessageUseCase',
              traceId: message.traceId,
              data: this.redactionPolicy.redact(
                {
                  ...error.metadata,
                  operation: 'process_job_message'
                },
                {
                  context: 'log'
                }
              ) as Record<string, unknown>,
              recordedAt: this.clock.now()
            });
            return;
          }

          try {
            const recovery = await this.runStage(
              {
                traceId: message.traceId,
                jobId: context?.job.jobId ?? message.jobId,
                documentId: context?.document.documentId ?? message.documentId,
                attemptId: context?.attempt.attemptId ?? message.attemptId,
                operation: 'failure_recovery',
                spanName: 'worker.failure_recovery'
              },
              () =>
                this.failureRecovery.recover({
                  error,
                  context,
                  now: this.clock.now()
                })
            );

            if (recovery === 'retry_scheduled') {
              await this.logging.log({
                level: 'warn',
                message: 'Processing failed and retry was scheduled',
                context: 'ProcessJobMessageUseCase',
                traceId: message.traceId,
                data: this.redactionPolicy.redact(
                  {
                    jobId: context?.job.jobId ?? message.jobId,
                    attemptId: context?.attempt.attemptId ?? message.attemptId,
                    documentId: context?.document.documentId ?? message.documentId,
                    operation: 'failure_recovery'
                  },
                  {
                    context: 'log'
                  }
                ) as Record<string, unknown>,
                recordedAt: this.clock.now()
              });
              await this.metrics.increment({
                name: 'worker.queue_publication_outbox.enqueued',
                traceId: message.traceId,
                tags: {
                  ownerService: 'document-processing-worker',
                  flowType: 'retry',
                  dispatchKind: 'publish_retry'
                }
              });
              await this.metrics.increment({
                name: 'worker.process_job_message.retry_scheduled',
                traceId: message.traceId,
                tags: this.buildTags({
                  jobId: context?.job.jobId ?? message.jobId,
                  documentId: context?.document.documentId ?? message.documentId,
                  attemptId: context?.attempt.attemptId ?? message.attemptId,
                  operation: 'failure_recovery'
                })
              });
              return;
            }
          } catch (handledError) {
            await this.metrics.increment({
              name: 'worker.process_job_message.failed',
              traceId: message.traceId,
              tags: this.buildTags({
                jobId: context?.job.jobId ?? message.jobId,
                documentId: context?.document.documentId ?? message.documentId,
                attemptId: context?.attempt.attemptId ?? message.attemptId,
                operation: 'process_job_message'
              })
            });
            await this.logging.log({
              level: 'error',
              message:
                handledError instanceof ProcessingContextIntegrityError
                  ? 'Processing moved to dead letter due to invalid worker context'
                  : 'Processing moved to dead letter',
              context: 'ProcessJobMessageUseCase',
              traceId: message.traceId,
              data: this.redactionPolicy.redact(
                {
                  jobId: context?.job.jobId ?? message.jobId,
                  attemptId: context?.attempt.attemptId ?? message.attemptId,
                  documentId: context?.document.documentId ?? message.documentId,
                  contextIssue:
                    handledError instanceof ProcessingContextIntegrityError
                      ? handledError.contextIssue
                      : undefined,
                  missingResources:
                    handledError instanceof ProcessingContextIntegrityError
                      ? handledError.missingResources
                      : undefined,
                  mismatches:
                    handledError instanceof ProcessingContextIntegrityError
                      ? handledError.mismatches
                      : undefined,
                  operation: 'process_job_message',
                  errorMessage: handledError instanceof Error ? handledError.message : 'Unexpected failure'
                },
                {
                  context: 'log'
                }
              ) as Record<string, unknown>,
              recordedAt: this.clock.now()
            });
            throw handledError;
          }
        } finally {
          await this.metrics.recordHistogram({
            name: 'worker.process_job_message.duration_ms',
            value: Date.now() - startedAt,
            traceId: message.traceId,
            tags: this.buildTags({
              jobId: context?.job.jobId ?? message.jobId,
              documentId: context?.document.documentId ?? message.documentId,
              attemptId: context?.attempt.attemptId ?? message.attemptId,
              operation: 'process_job_message'
            })
          });
        }
      }
    );
  }

  private buildTags(input: {
    jobId: string;
    documentId: string;
    attemptId: string;
    operation: string;
  }): Record<string, string> {
    return {
      jobId: input.jobId,
      documentId: input.documentId,
      attemptId: input.attemptId,
      operation: input.operation
    };
  }

  private async runStage<T>(input: {
    traceId: string;
    jobId: string;
    documentId: string;
    attemptId: string;
    operation: string;
    spanName: string;
  }, work: () => Promise<T>): Promise<T> {
    return this.tracing.runInSpan(
      {
        traceId: input.traceId,
        spanName: input.spanName,
        attributes: {
          jobId: input.jobId,
          documentId: input.documentId,
          attemptId: input.attemptId,
          operation: input.operation
        }
      },
      work
    );
  }
}
