import { JobStatus } from '@document-parser/shared-kernel';

export class ProcessingOutcomePolicy {
  public decide(input: { payload: string; warnings: string[] }): JobStatus.COMPLETED | JobStatus.PARTIAL {
    if (input.payload.includes('[ilegível]') || input.warnings.length > 0) {
      return JobStatus.PARTIAL;
    }

    return JobStatus.COMPLETED;
  }
}

