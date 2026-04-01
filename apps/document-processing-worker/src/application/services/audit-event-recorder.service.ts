import { Inject, Injectable } from '@nestjs/common';
import {
  BaseAuditEventRecorder,
  type AuditEventRecorderInput,
  RedactionPolicyService,
  RetentionPolicyService,
  Role,
  type AuditActor
} from '@document-parser/shared-kernel';
import type { AuditPort, IdGeneratorPort } from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';

const SYSTEM_ACTOR: AuditActor = {
  actorId: 'document-processing-worker',
  role: Role.OWNER
};

@Injectable()
export class AuditEventRecorder extends BaseAuditEventRecorder {
  public constructor(
    @Inject(TOKENS.AUDIT) audit: AuditPort,
    @Inject(TOKENS.ID_GENERATOR) idGenerator: IdGeneratorPort,
    retentionPolicy: RetentionPolicyService,
    redactionPolicy: RedactionPolicyService
  ) {
    super({
      save: async (event) => audit.record(event),
      nextId: (prefix) => idGenerator.next(prefix),
      retentionPolicy,
      redactionPolicy,
      defaultActor: SYSTEM_ACTOR
    });
  }

  public async record(input: AuditEventRecorderInput): Promise<void> {
    await this.recordWithPolicy(input);
  }
}
