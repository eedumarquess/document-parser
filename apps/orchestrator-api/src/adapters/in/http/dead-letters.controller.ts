import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res
} from '@nestjs/common';
import { ApplicationError, ErrorCode, JobStatus } from '@document-parser/shared-kernel';
import type { Request, Response } from 'express';
import { ReplayDeadLetterUseCase } from '../../../application/use-cases/replay-dead-letter.use-case';
import type { HttpErrorResponse } from '../../../contracts/http';
import { resolveHttpRequestContext } from './request-context';

@Controller('/v1/parsing/dead-letters')
export class DeadLettersController {
  public constructor(private readonly replayDeadLetterUseCase: ReplayDeadLetterUseCase) {}

  @Post(':dlqEventId/replay')
  public async replay(
    @Param('dlqEventId') dlqEventId: string,
    @Body() body: { reason?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const { actor, traceId } = resolveHttpRequestContext(request, response);

    try {
      const result = await this.replayDeadLetterUseCase.execute(
        {
          dlqEventId,
          reason: body.reason ?? ''
        },
        actor,
        traceId
      );
      response.status(result.status === JobStatus.PUBLISH_PENDING ? HttpStatus.ACCEPTED : HttpStatus.CREATED);
      return result;
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private toHttpException(error: unknown): HttpException {
    if (error instanceof ApplicationError) {
      return new HttpException(
        this.buildErrorResponse(error.errorCode, error.message, error.metadata),
        error.httpStatus
      );
    }

    return new HttpException(
      this.buildErrorResponse(
        ErrorCode.FATAL_FAILURE,
        error instanceof Error ? error.message : 'Unexpected failure'
      ),
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  private buildErrorResponse(
    errorCode: ErrorCode,
    message: string,
    metadata?: Record<string, unknown>
  ): HttpErrorResponse {
    return {
      errorCode,
      message,
      metadata
    };
  }
}
