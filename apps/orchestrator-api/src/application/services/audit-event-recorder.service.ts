import { Inject, Injectable } from '@nestjs/common';
import {
  BaseAuditEventRecorder,
  RedactionPolicyService,
  type AuditActor,
  type AuditEventRecorderInput
} from '@document-parser/shared-kernel';
import type { AuditPort, IdGeneratorPort } from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';

type OrchestratorAuditEventRecorderInput = Omit<AuditEventRecorderInput, 'actor'> & {
  actor: AuditActor;
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
      redactionPolicy
    });
  }

  public async record(input: OrchestratorAuditEventRecorderInput): Promise<void> {
    await this.recordWithPolicy(input);
  }
}
