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
import {
  ApplicationError,
  ErrorCode,
  Role,
  type AuditActor
} from '@document-parser/shared-kernel';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { ReplayDeadLetterUseCase } from '../../../application/use-cases/replay-dead-letter.use-case';
import type { HttpErrorResponse } from '../../../contracts/http';

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
    const traceId = request.header('x-trace-id') ?? randomUUID();
    response.setHeader('x-trace-id', traceId);

    try {
      return await this.replayDeadLetterUseCase.execute(
        {
          dlqEventId,
          reason: body.reason ?? ''
        },
        this.resolveActor(request),
        traceId
      );
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private resolveActor(request: Request): AuditActor {
    const actorId = request.header('x-actor-id') ?? 'local-owner';
    const rawRole = request.header('x-role');
    const role = rawRole === Role.OPERATOR ? Role.OPERATOR : Role.OWNER;
    return { actorId, role };
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
