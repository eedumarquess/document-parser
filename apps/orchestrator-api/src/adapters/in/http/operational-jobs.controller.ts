import {
  Controller,
  Get,
  Param,
  Req,
  Res
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExcludeEndpoint,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { GetJobOperationalContextUseCase } from '../../../application/use-cases/get-job-operational-context.use-case';
import { toHttpException } from './http-errors';
import { renderJobOperationalPanel } from './job-operational-panel.view';
import { resolveHttpRequestContext } from './request-context';
import { ApiOptionalRequestContextHeaders } from './swagger.decorators';
import { HttpErrorResponseDto, JobOperationalContextResponseDto } from './swagger.models';

@ApiTags('Operations')
@ApiOptionalRequestContextHeaders()
@Controller()
export class OperationalJobsController {
  public constructor(
    private readonly getJobOperationalContextUseCase: GetJobOperationalContextUseCase
  ) {}

  @Get('/v1/ops/jobs/:jobId/context')
  @ApiOperation({ summary: 'Get the aggregated operational context for a job' })
  @ApiParam({ name: 'jobId' })
  @ApiOkResponse({ type: JobOperationalContextResponseDto })
  @ApiBadRequestResponse({ type: HttpErrorResponseDto })
  @ApiNotFoundResponse({ type: HttpErrorResponseDto })
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
  @ApiExcludeEndpoint()
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
