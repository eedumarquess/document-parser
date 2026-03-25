import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApplicationError,
  DEFAULT_REQUESTED_MODE,
  Role,
  type AuditActor
} from '@document-parser/shared-kernel';
import type { Request } from 'express';
import { GetJobStatusUseCase } from '../../../application/use-cases/get-job-status.use-case';
import { GetProcessingResultUseCase } from '../../../application/use-cases/get-processing-result.use-case';
import { ReprocessDocumentUseCase } from '../../../application/use-cases/reprocess-document.use-case';
import { SubmitDocumentUseCase } from '../../../application/use-cases/submit-document.use-case';

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
    @Req() request: Request
  ) {
    if (file === undefined) {
      throw new HttpException({ errorCode: 'VALIDATION_ERROR', message: 'file is required' }, 400);
    }

    try {
      return await this.submitDocumentUseCase.execute(
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
        this.resolveActor(request)
      );
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Get(':jobId')
  public async getStatus(@Param('jobId') jobId: string, @Req() request: Request) {
    try {
      return await this.getJobStatusUseCase.execute({ jobId }, this.resolveActor(request));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Get(':jobId/result')
  public async getResult(@Param('jobId') jobId: string, @Req() request: Request) {
    try {
      return await this.getProcessingResultUseCase.execute({ jobId }, this.resolveActor(request));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  @Post(':jobId/reprocess')
  public async reprocess(
    @Param('jobId') jobId: string,
    @Body() body: { reason?: string },
    @Req() request: Request
  ) {
    try {
      return await this.reprocessDocumentUseCase.execute(
        {
          jobId,
          reason: body.reason ?? ''
        },
        this.resolveActor(request)
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
        {
          errorCode: error.errorCode,
          message: error.message,
          metadata: error.metadata
        },
        error.httpStatus
      );
    }

    return new HttpException(
      {
        errorCode: 'FATAL_FAILURE',
        message: error instanceof Error ? error.message : 'Unexpected failure'
      },
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
