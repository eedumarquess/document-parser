import { Injectable } from '@nestjs/common';
import { AuthorizationError, Role, type AuditActor } from '@document-parser/shared-kernel';
import type { AuthorizationPort } from '../../../contracts/ports';

@Injectable()
export class SimpleRbacAuthorizationAdapter implements AuthorizationPort {
  public ensureCanSubmit(actor: AuditActor): void {
    if (actor.role !== Role.OWNER) {
      throw new AuthorizationError('Only OWNER can submit new documents');
    }
  }

  public ensureCanRead(actor: AuditActor): void {
    if (actor.role !== Role.OWNER && actor.role !== Role.OPERATOR) {
      throw new AuthorizationError('Only OWNER or OPERATOR can read jobs and results');
    }
  }

  public ensureCanReprocess(actor: AuditActor): void {
    if (actor.role !== Role.OWNER) {
      throw new AuthorizationError('Only OWNER can request reprocessing');
    }
  }
}

