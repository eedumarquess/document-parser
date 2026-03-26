import { Inject, Injectable } from '@nestjs/common';
import { RedactionPolicyService } from '@document-parser/shared-kernel';
import type { ClockPort, LoggingPort, MetricsPort, TracingPort } from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type { ProcessJobMessageCommand } from '../commands/process-job-message.command';
import type { ProcessingMessageContext } from '../services/processing-execution-context';
import { AttemptExecutionCoordinator } from '../services/attempt-execution-coordinator.service';
import {
  IncompleteProcessingContextError,
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
          context = await this.contextLoader.load(message);
          context = await this.attemptExecutionCoordinator.start(context, this.clock.now());
          const execution = await this.attemptExecutionCoordinator.execute(context);
          const completedAt = this.clock.now();

          await this.successPersister.persist({
            context: execution.context,
            outcome: execution.outcome,
            now: completedAt
          });

          await this.logging.log({
            level: 'info',
            message: 'Processing completed successfully',
            context: 'ProcessJobMessageUseCase',
            traceId: message.traceId,
            data: this.redactionPolicy.redact(
              {
                jobId: execution.context.job.jobId,
                attemptId: execution.context.attempt.attemptId,
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
            traceId: message.traceId
          });
        } catch (error) {
          try {
            const recovery = await this.failureRecovery.recover({
              error,
              context,
              now: this.clock.now()
            });

            if (recovery === 'retry_scheduled') {
              await this.logging.log({
                level: 'warn',
                message: 'Processing failed and retry was scheduled',
                context: 'ProcessJobMessageUseCase',
                traceId: message.traceId,
                data: this.redactionPolicy.redact(
                  {
                    jobId: context?.job.jobId ?? message.jobId,
                    attemptId: context?.attempt.attemptId ?? message.attemptId
                  },
                  {
                    context: 'log'
                  }
                ) as Record<string, unknown>,
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
              message:
                handledError instanceof IncompleteProcessingContextError
                  ? 'Processing moved to dead letter due to incomplete worker context'
                  : 'Processing moved to dead letter',
              context: 'ProcessJobMessageUseCase',
              traceId: message.traceId,
              data: this.redactionPolicy.redact(
                {
                  jobId: context?.job.jobId ?? message.jobId,
                  attemptId: context?.attempt.attemptId ?? message.attemptId,
                  documentId: context?.document.documentId ?? message.documentId,
                  missingResources:
                    handledError instanceof IncompleteProcessingContextError
                      ? handledError.missingResources
                      : undefined,
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
            traceId: message.traceId
          });
        }
      }
    );
  }
}
