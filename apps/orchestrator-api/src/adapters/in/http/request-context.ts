import { Role, type AuditActor } from '@document-parser/shared-kernel';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { createValidationHttpException } from './http-errors';

const DEFAULT_ACTOR_ID = 'local-owner';
const TRACE_ID_HEADER = 'x-trace-id';
const ACTOR_ID_HEADER = 'x-actor-id';
const ROLE_HEADER = 'x-role';
const ACCEPTED_ROLES: Record<Role, true> = {
  [Role.OWNER]: true,
  [Role.OPERATOR]: true
};

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

  if (isAcceptedRole(rawRole)) {
    return rawRole;
  }

  throw createValidationHttpException('Invalid x-role header', {
    header: ROLE_HEADER,
    acceptedValues: Object.keys(ACCEPTED_ROLES),
    receivedValue: rawRole
  });
};

const isAcceptedRole = (value: string): value is Role => Object.hasOwn(ACCEPTED_ROLES, value);
