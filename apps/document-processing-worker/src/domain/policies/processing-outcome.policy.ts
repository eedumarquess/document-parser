import { JobStatus, type JobWarning } from '@document-parser/shared-kernel';

export class ProcessingOutcomePolicy {
  public decide(input: { payload: string; warnings: JobWarning[] }): JobStatus.COMPLETED | JobStatus.PARTIAL {
    if (input.payload.includes('[ilegivel]') || input.warnings.length > 0) {
      return JobStatus.PARTIAL;
    }

    return JobStatus.COMPLETED;
  }
}
