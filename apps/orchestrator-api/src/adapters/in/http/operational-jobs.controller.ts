import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Req,
  Res
} from '@nestjs/common';
import { ApplicationError, ErrorCode } from '@document-parser/shared-kernel';
import type { Request, Response } from 'express';
import { GetJobOperationalContextUseCase } from '../../../application/use-cases/get-job-operational-context.use-case';
import type { HttpErrorResponse } from '../../../contracts/http';
import { renderJobOperationalPanel } from './job-operational-panel.view';
import { resolveHttpRequestContext } from './request-context';

@Controller()
export class OperationalJobsController {
  public constructor(
    private readonly getJobOperationalContextUseCase: GetJobOperationalContextUseCase
  ) {}

  @Get('/v1/ops/jobs/:jobId/context')
  public async getContext(
    @Param('jobId') jobId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const { actor, traceId } = resolveHttpRequestContext(request, response);

    try {
      return await this.getJobOperationalContextUseCase.execute({ jobId }, actor, traceId);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Get('/ops/jobs/:jobId')
  public async getPanel(
    @Param('jobId') jobId: string,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const { actor, traceId } = resolveHttpRequestContext(request, response);

    try {
      const context = await this.getJobOperationalContextUseCase.execute({ jobId }, actor, traceId);
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.send(renderJobOperationalPanel(context));
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
