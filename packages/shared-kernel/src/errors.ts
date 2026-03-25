import { ErrorCode } from './enums';

export class ApplicationError extends Error {
  public readonly errorCode: ErrorCode;
  public readonly httpStatus: number;
  public readonly metadata?: Record<string, unknown>;

  public constructor(
    errorCode: ErrorCode,
    message: string,
    httpStatus: number,
    metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.errorCode = errorCode;
    this.httpStatus = httpStatus;
    this.metadata = metadata;
  }
}

export class ValidationError extends ApplicationError {
  public constructor(message: string, metadata?: Record<string, unknown>) {
    super(ErrorCode.VALIDATION_ERROR, message, 400, metadata);
    this.name = 'ValidationError';
  }
}

export class AuthorizationError extends ApplicationError {
  public constructor(message = 'Actor is not allowed to perform this action') {
    super(ErrorCode.AUTHORIZATION_ERROR, message, 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends ApplicationError {
  public constructor(message: string, metadata?: Record<string, unknown>) {
    super(ErrorCode.NOT_FOUND, message, 404, metadata);
    this.name = 'NotFoundError';
  }
}

export class TransientFailureError extends ApplicationError {
  public constructor(message: string, metadata?: Record<string, unknown>) {
    super(ErrorCode.TRANSIENT_FAILURE, message, 503, metadata);
    this.name = 'TransientFailureError';
  }
}

export class FatalFailureError extends ApplicationError {
  public constructor(message: string, metadata?: Record<string, unknown>) {
    super(ErrorCode.FATAL_FAILURE, message, 500, metadata);
    this.name = 'FatalFailureError';
  }
}

export class TimeoutFailureError extends ApplicationError {
  public constructor(message: string, metadata?: Record<string, unknown>) {
    super(ErrorCode.TIMEOUT, message, 504, metadata);
    this.name = 'TimeoutFailureError';
  }
}
