import { AttemptStatus } from '@document-parser/shared-kernel';
import type { JobAttemptRecord } from '../../contracts/models';

export class JobAttemptEntity {
  public static createRetry(input: {
    attemptId: string;
    jobId: string;
    attemptNumber: number;
    pipelineVersion: string;
    now: Date;
  }): JobAttemptRecord {
    return {
      attemptId: input.attemptId,
      jobId: input.jobId,
      attemptNumber: input.attemptNumber,
      pipelineVersion: input.pipelineVersion,
      status: AttemptStatus.QUEUED,
      fallbackUsed: false,
      createdAt: input.now
    };
  }
}

