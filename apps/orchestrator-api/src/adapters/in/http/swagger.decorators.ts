import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export function ApiOptionalRequestContextHeaders() {
  return applyDecorators(
    ApiHeader({
      name: 'x-role',
      required: false,
      description: 'Optional advanced header. Defaults to OWNER. Accepted values: OWNER, OPERATOR.'
    }),
    ApiHeader({
      name: 'x-trace-id',
      required: false,
      description: 'Optional advanced header for request correlation. Generated automatically when omitted.'
    }),
    ApiHeader({
      name: 'x-actor-id',
      required: false,
      description: 'Optional advanced header identifying the caller. Defaults to local-owner when omitted.'
    })
  );
}
