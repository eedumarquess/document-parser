import {
  Controller,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiGatewayTimeoutResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import { DEFAULT_REQUESTED_MODE } from '@document-parser/shared-kernel';
import type { Request, Response } from 'express';
import { SubmitDocumentAndWaitUseCase } from '../../../application/use-cases/submit-document-and-wait.use-case';
import { createValidationHttpException, toHttpException } from './http-errors';
import { resolveHttpRequestContext } from './request-context';
import { ApiOptionalRequestContextHeaders } from './swagger.decorators';
import {
  HttpErrorResponseDto,
  SubmitAndWaitResponseDto
} from './swagger.models';

type UploadedMultipartFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@ApiTags('System', 'Jobs')
@ApiOptionalRequestContextHeaders()
@Controller('/v1/dev/parsing/jobs')
export class DevConvenienceController {
  public constructor(
    private readonly submitDocumentAndWaitUseCase: SubmitDocumentAndWaitUseCase
  ) {}

  @Post('submit-and-wait')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Dev-only helper that submits a file and waits for a terminal result' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary'
        },
        requestedMode: {
          type: 'string',
          default: DEFAULT_REQUESTED_MODE
        },
        forceReprocess: {
          type: 'string',
          enum: ['true', 'false']
        }
      }
    }
  })
  @ApiOkResponse({ type: SubmitAndWaitResponseDto })
  @ApiBadRequestResponse({ type: HttpErrorResponseDto })
  @ApiConflictResponse({ type: HttpErrorResponseDto })
  @ApiGatewayTimeoutResponse({ type: HttpErrorResponseDto })
  public async submitAndWait(
    @UploadedFile() file: UploadedMultipartFile | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const { actor, traceId } = resolveHttpRequestContext(request, response);

    if (file === undefined) {
      throw createValidationHttpException('file is required');
    }

    try {
      response.status(200);
      return await this.submitDocumentAndWaitUseCase.execute(
        {
          file: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            buffer: file.buffer
          },
          requestedMode:
            (request.body as { requestedMode?: string } | undefined)?.requestedMode ?? DEFAULT_REQUESTED_MODE,
          forceReprocess:
            (request.body as { forceReprocess?: string } | undefined)?.forceReprocess === 'true'
        },
        actor,
        traceId
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }
}
