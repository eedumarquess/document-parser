import { Inject, Injectable } from '@nestjs/common';
import { startPendingAttempt } from '@document-parser/document-processing-domain';
import type { ProcessingOutcome } from '@document-parser/shared-kernel';
import type {
  BinaryStoragePort,
  ExtractionPipelinePort,
  JobAttemptRepositoryPort,
  ProcessingJobRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type {
  ProcessingExecutionContext,
  ProcessingMessageContext
} from './processing-execution-context';

@Injectable()
export class AttemptExecutionCoordinator {
  public constructor(
    @Inject(TOKENS.STORAGE) private readonly storage: BinaryStoragePort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TOKENS.EXTRACTION_PIPELINE) private readonly extraction: ExtractionPipelinePort
  ) {}

  public async start(input: ProcessingMessageContext, now: Date): Promise<ProcessingMessageContext> {
    const started = startPendingAttempt({
      job: input.job,
      attempt: input.attempt,
      now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(started.job);
      await this.attempts.save(started.attempt);
    });

    return {
      ...input,
      job: started.job,
      attempt: started.attempt
    };
  }

  public async execute(
    input: ProcessingMessageContext
  ): Promise<{ context: ProcessingExecutionContext; outcome: ProcessingOutcome }> {
    const original = await this.storage.read(input.document.storageReference);
    const context: ProcessingExecutionContext = {
      ...input,
      original
    };

    return {
      context,
      outcome: await this.extraction.extract({
        actor: input.job.requestedBy,
        document: input.document,
        job: input.job,
        attempt: input.attempt,
        original
      })
    };
  }
}
