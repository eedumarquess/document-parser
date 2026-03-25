import { Inject, Injectable } from '@nestjs/common';
import { FatalFailureError, type ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
import type {
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  ProcessingJobRepositoryPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type {
  PartialProcessingMessageContext,
  ProcessingMessageContext
} from './processing-execution-context';

export class IncompleteProcessingContextError extends FatalFailureError {
  public readonly partialContext: PartialProcessingMessageContext;
  public readonly missingResources: string[];

  public constructor(input: PartialProcessingMessageContext & { missingResources: string[] }) {
    super('Worker context is incomplete', {
      jobId: input.message.jobId,
      attemptId: input.message.attemptId,
      documentId: input.message.documentId,
      missingResources: input.missingResources
    });
    this.name = 'IncompleteProcessingContextError';
    this.partialContext = input;
    this.missingResources = input.missingResources;
  }
}

@Injectable()
export class ProcessingContextLoader {
  public constructor(
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort
  ) {}

  public async load(message: ProcessingJobRequestedMessage): Promise<ProcessingMessageContext> {
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

    if (missingResources.length > 0) {
      throw new IncompleteProcessingContextError({
        message,
        job,
        document,
        attempt,
        missingResources
      });
    }

    return {
      message,
      job: job!,
      document: document!,
      attempt: attempt!
    };
  }
}
