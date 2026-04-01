import {
  Controller,
  Get,
  Param,
  Req,
  Res
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GetJobOperationalContextUseCase } from '../../../application/use-cases/get-job-operational-context.use-case';
import { toHttpException } from './http-errors';
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
      throw toHttpException(error);
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
      throw toHttpException(error);
    }
  }
}
