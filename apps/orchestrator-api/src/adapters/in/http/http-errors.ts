import { HttpException, HttpStatus } from '@nestjs/common';
import { ApplicationError, ErrorCode } from '@document-parser/shared-kernel';
import type { HttpErrorResponse } from '../../../contracts/http';

export const buildHttpErrorResponse = (
  errorCode: ErrorCode,
  message: string,
  metadata?: Record<string, unknown>
): HttpErrorResponse => ({
  errorCode,
  message,
  metadata
});

export const createValidationHttpException = (
  message: string,
  metadata?: Record<string, unknown>
): HttpException =>
  new HttpException(
    buildHttpErrorResponse(ErrorCode.VALIDATION_ERROR, message, metadata),
    HttpStatus.BAD_REQUEST
  );

export const toHttpException = (error: unknown): HttpException => {
  if (error instanceof ApplicationError) {
    return new HttpException(
      buildHttpErrorResponse(error.errorCode, error.message, error.metadata),
      error.httpStatus
    );
  }

  return new HttpException(
    buildHttpErrorResponse(
      ErrorCode.FATAL_FAILURE,
      error instanceof Error ? error.message : 'Unexpected failure'
    ),
    HttpStatus.INTERNAL_SERVER_ERROR
  );
};
