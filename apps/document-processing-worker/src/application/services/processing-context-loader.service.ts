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

type ProcessingContextIssue = 'missing_resource' | 'relationship_mismatch';

type ProcessingContextMismatch = {
  rule: string;
  expected: string;
  actual: string;
};

type ProcessingContextIntegrityErrorInput = PartialProcessingMessageContext & {
  contextIssue: ProcessingContextIssue;
  missingResources?: string[];
  mismatches?: ProcessingContextMismatch[];
};

export class ProcessingContextIntegrityError extends FatalFailureError {
  public readonly partialContext: PartialProcessingMessageContext;
  public readonly contextIssue: ProcessingContextIssue;
  public readonly missingResources?: string[];
  public readonly mismatches?: ProcessingContextMismatch[];

  protected constructor(message: string, input: ProcessingContextIntegrityErrorInput) {
    super(message, {
      jobId: input.message.jobId,
      attemptId: input.message.attemptId,
      documentId: input.message.documentId,
      contextIssue: input.contextIssue,
      missingResources: input.missingResources,
      mismatches: input.mismatches
    });
    this.name = 'ProcessingContextIntegrityError';
    this.partialContext = input;
    this.contextIssue = input.contextIssue;
    this.missingResources = input.missingResources;
    this.mismatches = input.mismatches;
  }
}

export class IncompleteProcessingContextError extends ProcessingContextIntegrityError {
  public constructor(input: PartialProcessingMessageContext & { missingResources: string[] }) {
    super('Worker context is incomplete', {
      ...input,
      contextIssue: 'missing_resource'
    });
    this.name = 'IncompleteProcessingContextError';
  }
}

export class InconsistentProcessingContextError extends ProcessingContextIntegrityError {
  public constructor(input: PartialProcessingMessageContext & { mismatches: ProcessingContextMismatch[] }) {
    super('Worker context is inconsistent', {
      ...input,
      contextIssue: 'relationship_mismatch'
    });
    this.name = 'InconsistentProcessingContextError';
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

    const loadedContext: ProcessingMessageContext = {
      message,
      job: job!,
      document: document!,
      attempt: attempt!
    };
    const mismatches = [
      loadedContext.attempt.jobId !== loadedContext.job.jobId
        ? {
            rule: 'attempt.jobId === job.jobId',
            expected: loadedContext.job.jobId,
            actual: loadedContext.attempt.jobId
          }
        : undefined,
      loadedContext.job.documentId !== loadedContext.document.documentId
        ? {
            rule: 'job.documentId === document.documentId',
            expected: loadedContext.document.documentId,
            actual: loadedContext.job.documentId
          }
        : undefined,
      loadedContext.message.jobId !== loadedContext.job.jobId
        ? {
            rule: 'message.jobId === job.jobId',
            expected: loadedContext.message.jobId,
            actual: loadedContext.job.jobId
          }
        : undefined,
      loadedContext.message.documentId !== loadedContext.document.documentId
        ? {
            rule: 'message.documentId === document.documentId',
            expected: loadedContext.message.documentId,
            actual: loadedContext.document.documentId
          }
        : undefined,
      loadedContext.message.attemptId !== loadedContext.attempt.attemptId
        ? {
            rule: 'message.attemptId === attempt.attemptId',
            expected: loadedContext.message.attemptId,
            actual: loadedContext.attempt.attemptId
          }
        : undefined
    ].filter((mismatch): mismatch is ProcessingContextMismatch => mismatch !== undefined);

    if (mismatches.length > 0) {
      throw new InconsistentProcessingContextError({
        ...loadedContext,
        mismatches
      });
    }

    return loadedContext;
  }
}
