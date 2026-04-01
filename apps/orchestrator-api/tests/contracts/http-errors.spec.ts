import { HttpStatus } from '@nestjs/common';
import { ApplicationError, ErrorCode } from '@document-parser/shared-kernel';
import {
  buildHttpErrorResponse,
  createValidationHttpException,
  toHttpException
} from '../../src/adapters/in/http/http-errors';

describe('HTTP error helpers', () => {
  it('builds the standard error envelope', () => {
    expect(
      buildHttpErrorResponse(ErrorCode.NOT_FOUND, 'Processing job not found', {
        jobId: 'job-1'
      })
    ).toEqual({
      errorCode: ErrorCode.NOT_FOUND,
      message: 'Processing job not found',
      metadata: {
        jobId: 'job-1'
      }
    });
  });

  it('creates a bad request exception for validation failures', () => {
    const exception = createValidationHttpException('Invalid x-role header', {
      header: 'x-role'
    });

    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(exception.getResponse()).toEqual({
      errorCode: ErrorCode.VALIDATION_ERROR,
      message: 'Invalid x-role header',
      metadata: {
        header: 'x-role'
      }
    });
  });

  it('maps ApplicationError preserving status and metadata', () => {
    const exception = toHttpException(
      new ApplicationError(ErrorCode.NOT_FOUND, 'Processing job not found', HttpStatus.NOT_FOUND, {
        jobId: 'job-1'
      })
    );

    expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(exception.getResponse()).toEqual({
      errorCode: ErrorCode.NOT_FOUND,
      message: 'Processing job not found',
      metadata: {
        jobId: 'job-1'
      }
    });
  });

  it('maps unexpected failures to a fatal 500 envelope', () => {
    const exception = toHttpException(new Error('publisher offline'));

    expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(exception.getResponse()).toEqual({
      errorCode: ErrorCode.FATAL_FAILURE,
      message: 'publisher offline',
      metadata: undefined
    });
  });
});
