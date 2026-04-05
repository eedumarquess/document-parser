import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ApplicationError,
  ErrorCode,
  JobStatus,
  type AuditActor
} from '@document-parser/shared-kernel';
import type {
  JobResponse,
  SubmitAndWaitResponse
} from '../../contracts/http';
import { TOKENS } from '../../contracts/tokens';
import { GetJobStatusUseCase } from './get-job-status.use-case';
import { GetProcessingResultUseCase } from './get-processing-result.use-case';
import { SubmitDocumentUseCase } from './submit-document.use-case';
import type { SubmitDocumentCommand } from '../commands/submit-document.command';

export type DevConvenienceRuntime = {
  enabled: boolean;
  pollIntervalMs: number;
  timeoutMs: number;
};

export const DEFAULT_DEV_CONVENIENCE_RUNTIME: DevConvenienceRuntime = {
  enabled: false,
  pollIntervalMs: 250,
  timeoutMs: 15_000
};

@Injectable()
export class SubmitDocumentAndWaitUseCase {
  public constructor(
    private readonly submitDocumentUseCase: SubmitDocumentUseCase,
    private readonly getJobStatusUseCase: GetJobStatusUseCase,
    private readonly getProcessingResultUseCase: GetProcessingResultUseCase,
    @Inject(TOKENS.DEV_CONVENIENCE_RUNTIME)
    private readonly runtime: DevConvenienceRuntime
  ) {}

  public async execute(
    command: SubmitDocumentCommand,
    actor: AuditActor,
    traceId: string
  ): Promise<SubmitAndWaitResponse> {
    const initialJob = await this.submitDocumentUseCase.execute(command, actor, traceId);
    const deadline = Date.now() + this.runtime.timeoutMs;

    while (Date.now() <= deadline) {
      const job = await this.getJobStatusUseCase.execute({ jobId: initialJob.jobId }, actor, traceId);

      if (job.status === JobStatus.COMPLETED || job.status === JobStatus.PARTIAL) {
        return {
          job,
          result: await this.getProcessingResultUseCase.execute({ jobId: job.jobId }, actor, traceId)
        };
      }

      if (job.status === JobStatus.FAILED) {
        throw this.buildFailedJobError(job);
      }

      if (Date.now() + this.runtime.pollIntervalMs > deadline) {
        break;
      }

      await this.sleep(this.runtime.pollIntervalMs);
    }

    throw this.buildTimeoutError(initialJob);
  }

  private buildFailedJobError(job: JobResponse): ApplicationError {
    return new ApplicationError(
      ErrorCode.TRANSIENT_FAILURE,
      'Processing job failed before a result became available',
      HttpStatus.CONFLICT,
      {
        jobId: job.jobId,
        status: job.status
      }
    );
  }

  private buildTimeoutError(job: JobResponse): ApplicationError {
    return new ApplicationError(
      ErrorCode.TIMEOUT,
      'Processing did not finish before the dev convenience timeout',
      HttpStatus.GATEWAY_TIMEOUT,
      {
        jobId: job.jobId
      }
    );
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
