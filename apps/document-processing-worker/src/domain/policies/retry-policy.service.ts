import { MAX_RETRY_ATTEMPTS } from '@document-parser/shared-kernel';

export class RetryPolicyService {
  public shouldRetry(attemptNumber: number): boolean {
    return attemptNumber < MAX_RETRY_ATTEMPTS;
  }

  public calculateDelayMs(attemptNumber: number): number {
    return 2 ** attemptNumber * 1000;
  }
}

