import {
  ErrorCode,
  MAX_RETRY_ATTEMPTS,
  RETRY_DELAYS_MS
} from '@document-parser/shared-kernel';
import type { FailureClassification } from './failure-classification';

export type RetryDecision =
  | {
      action: 'retry';
      delayMs: number;
      nextAttemptNumber: number;
    }
  | {
      action: 'move_to_dlq';
      reasonCode: ErrorCode.DLQ_ERROR | ErrorCode.FATAL_FAILURE | ErrorCode.TIMEOUT;
    };

export class RetryPolicyService {
  public shouldRetry(
    attemptNumber: number,
    classification: FailureClassification = ErrorCode.TRANSIENT_FAILURE
  ): boolean {
    if (classification === ErrorCode.FATAL_FAILURE) {
      return false;
    }

    return attemptNumber < MAX_RETRY_ATTEMPTS;
  }

  public calculateDelayMs(attemptNumber: number): number {
    return RETRY_DELAYS_MS[attemptNumber - 1] ?? RETRY_DELAYS_MS.at(-1) ?? 0;
  }

  public decideRetryAfterAttemptFailure(input: {
    attemptNumber: number;
    classification: FailureClassification;
  }): RetryDecision {
    if (this.shouldRetry(input.attemptNumber, input.classification)) {
      return {
        action: 'retry',
        delayMs: this.calculateDelayMs(input.attemptNumber),
        nextAttemptNumber: input.attemptNumber + 1
      };
    }

    if (input.classification === ErrorCode.FATAL_FAILURE) {
      return {
        action: 'move_to_dlq',
        reasonCode: ErrorCode.FATAL_FAILURE
      };
    }

    return {
      action: 'move_to_dlq',
      reasonCode: input.classification === ErrorCode.TIMEOUT ? ErrorCode.TIMEOUT : ErrorCode.DLQ_ERROR
    };
  }
}
