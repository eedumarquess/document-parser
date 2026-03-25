import {
  ApplicationError,
  ErrorCode,
  FatalFailureError,
  TimeoutFailureError,
  TransientFailureError
} from '@document-parser/shared-kernel';

export type FailureClassification =
  | ErrorCode.TRANSIENT_FAILURE
  | ErrorCode.FATAL_FAILURE
  | ErrorCode.TIMEOUT;

export function classifyAttemptFailure(error: unknown): FailureClassification {
  if (error instanceof TimeoutFailureError) {
    return ErrorCode.TIMEOUT;
  }

  if (error instanceof TransientFailureError) {
    return ErrorCode.TRANSIENT_FAILURE;
  }

  if (error instanceof FatalFailureError) {
    return ErrorCode.FATAL_FAILURE;
  }

  if (error instanceof ApplicationError && error.errorCode === ErrorCode.TIMEOUT) {
    return ErrorCode.TIMEOUT;
  }

  if (error instanceof ApplicationError && error.errorCode === ErrorCode.TRANSIENT_FAILURE) {
    return ErrorCode.TRANSIENT_FAILURE;
  }

  return ErrorCode.FATAL_FAILURE;
}

export function buildFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown failure';
}
