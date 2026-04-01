import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  DEFAULT_REQUESTED_MODE,
  JobStatus
} from '@document-parser/shared-kernel';
import type { Request, Response } from 'express';
import { GetJobStatusUseCase } from '../../../application/use-cases/get-job-status.use-case';
import { GetProcessingResultUseCase } from '../../../application/use-cases/get-processing-result.use-case';
import { ReprocessDocumentUseCase } from '../../../application/use-cases/reprocess-document.use-case';
import { SubmitDocumentUseCase } from '../../../application/use-cases/submit-document.use-case';
import { createValidationHttpException, toHttpException } from './http-errors';
import { resolveHttpRequestContext } from './request-context';

type UploadedMultipartFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Controller('/v1/parsing/jobs')
export class DocumentJobsController {
  public constructor(
    private readonly submitDocumentUseCase: SubmitDocumentUseCase,
    private readonly getJobStatusUseCase: GetJobStatusUseCase,
    private readonly getProcessingResultUseCase: GetProcessingResultUseCase,
    private readonly reprocessDocumentUseCase: ReprocessDocumentUseCase
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  public async submit(
    @UploadedFile() file: UploadedMultipartFile | undefined,
    @Body() body: { requestedMode?: string; forceReprocess?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const { actor, traceId } = resolveHttpRequestContext(request, response);

    if (file === undefined) {
      throw createValidationHttpException('file is required');
    }

    try {
      const result = await this.submitDocumentUseCase.execute(
        {
          file: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            buffer: file.buffer
          },
          requestedMode: body.requestedMode ?? DEFAULT_REQUESTED_MODE,
          forceReprocess: body.forceReprocess === 'true'
        },
        actor,
        traceId
      );
      this.applyAcceptedStatus(response, result.status);
      return result;
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Get(':jobId')
  public async getStatus(
    @Param('jobId') jobId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const { actor, traceId } = resolveHttpRequestContext(request, response);

    try {
      return await this.getJobStatusUseCase.execute({ jobId }, actor, traceId);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Get(':jobId/result')
  public async getResult(
    @Param('jobId') jobId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const { actor, traceId } = resolveHttpRequestContext(request, response);

    try {
      return await this.getProcessingResultUseCase.execute({ jobId }, actor, traceId);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Post(':jobId/reprocess')
  public async reprocess(
    @Param('jobId') jobId: string,
    @Body() body: { reason?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const { actor, traceId } = resolveHttpRequestContext(request, response);

    try {
      const result = await this.reprocessDocumentUseCase.execute(
        {
          jobId,
          reason: body.reason ?? ''
        },
        actor,
        traceId
      );
      this.applyAcceptedStatus(response, result.status);
      return result;
    } catch (error) {
      throw toHttpException(error);
    }
  }

  private applyAcceptedStatus(response: Response, status: JobStatus): void {
    response.status(status === JobStatus.PUBLISH_PENDING ? HttpStatus.ACCEPTED : HttpStatus.CREATED);
  }
}
