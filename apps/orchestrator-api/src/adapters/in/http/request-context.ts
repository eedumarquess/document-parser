import { Role, type AuditActor } from '@document-parser/shared-kernel';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { createValidationHttpException } from './http-errors';

const DEFAULT_ACTOR_ID = 'local-owner';
const TRACE_ID_HEADER = 'x-trace-id';
const ACTOR_ID_HEADER = 'x-actor-id';
const ROLE_HEADER = 'x-role';
const ACCEPTED_ROLES = [Role.OWNER, Role.OPERATOR] as const;

export type HttpRequestContext = {
  actor: AuditActor;
  traceId: string;
};

export const resolveHttpRequestContext = (
  request: Request,
  response: Response
): HttpRequestContext => {
  const traceId = request.header(TRACE_ID_HEADER) ?? randomUUID();
  response.setHeader(TRACE_ID_HEADER, traceId);

  return {
    actor: {
      actorId: request.header(ACTOR_ID_HEADER) ?? DEFAULT_ACTOR_ID,
      role: resolveRole(request.header(ROLE_HEADER))
    },
    traceId
  };
};

const resolveRole = (rawRole: string | undefined): Role => {
  if (rawRole === undefined) {
    return Role.OWNER;
  }

  if (rawRole === Role.OWNER || rawRole === Role.OPERATOR) {
    return rawRole;
  }

  throw createValidationHttpException('Invalid x-role header', {
    header: ROLE_HEADER,
    acceptedValues: [...ACCEPTED_ROLES],
    receivedValue: rawRole
  });
};
