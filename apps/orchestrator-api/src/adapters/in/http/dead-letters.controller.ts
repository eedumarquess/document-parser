import {
  Body,
  Controller,
  HttpStatus,
  Param,
  Post,
  Req,
  Res
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import { JobStatus } from '@document-parser/shared-kernel';
import type { Request, Response } from 'express';
import { ReplayDeadLetterUseCase } from '../../../application/use-cases/replay-dead-letter.use-case';
import { toHttpException } from './http-errors';
import { resolveHttpRequestContext } from './request-context';
import { ApiOptionalRequestContextHeaders } from './swagger.decorators';
import {
  HttpErrorResponseDto,
  JobResponseDto,
  ReplayDeadLetterRequestDto
} from './swagger.models';

@ApiTags('Dead Letters')
@ApiOptionalRequestContextHeaders()
@Controller('/v1/parsing/dead-letters')
export class DeadLettersController {
  public constructor(private readonly replayDeadLetterUseCase: ReplayDeadLetterUseCase) {}

  @Post(':dlqEventId/replay')
  @ApiOperation({ summary: 'Replay a dead-letter event into a new processing job' })
  @ApiParam({ name: 'dlqEventId' })
  @ApiBody({ type: ReplayDeadLetterRequestDto })
  @ApiCreatedResponse({ type: JobResponseDto })
  @ApiAcceptedResponse({ type: JobResponseDto })
  @ApiBadRequestResponse({ type: HttpErrorResponseDto })
  @ApiForbiddenResponse({ type: HttpErrorResponseDto })
  @ApiNotFoundResponse({ type: HttpErrorResponseDto })
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
      throw toHttpException(error);
    }
  }
}
