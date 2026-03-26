import { Inject, Injectable } from '@nestjs/common';
import {
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
export class AuditEventRecorder {
  public constructor(
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService
  ) {}

  public async record(input: {
    eventType: string;
    aggregateType?: string;
    aggregateId?: string;
    traceId: string;
    actor?: AuditActor;
    metadata?: Record<string, unknown>;
    redactedPayload?: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void> {
    await this.audit.record({
      eventId: this.idGenerator.next('audit'),
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      traceId: input.traceId,
      actor: input.actor ?? SYSTEM_ACTOR,
      metadata:
        input.metadata === undefined
          ? undefined
          : this.redactionPolicy.sanitizeMetadata(input.metadata, {
              context: 'audit'
            }),
      redactedPayload:
        input.redactedPayload ??
        (input.metadata === undefined
          ? undefined
          : this.redactionPolicy.redact(input.metadata, {
              context: 'audit'
            })),
      createdAt: input.createdAt,
      retentionUntil: this.retentionPolicy.calculateAuditRetentionUntil(input.createdAt)
    });
  }
}
