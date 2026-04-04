import type { RedactionPolicyService } from './redaction-policy.service';
import type { RetentionPolicyService } from './retention-policy.service';
import type { AuditActor, AuditEventRecord } from './types';

export type AuditEventRecorderInput = {
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  traceId: string;
  actor?: AuditActor;
  metadata?: Record<string, unknown>;
  redactedPayload?: Record<string, unknown>;
  createdAt: Date;
};

export type AuditEventRecorderDependencies = {
  save: (event: AuditEventRecord) => Promise<void>;
  nextId: (prefix: string) => string;
  retentionPolicy: RetentionPolicyService;
  redactionPolicy: RedactionPolicyService;
  defaultActor?: AuditActor;
};

export const buildAuditEventRecord = (
  input: AuditEventRecorderInput,
  dependencies: Omit<AuditEventRecorderDependencies, 'save'>
): AuditEventRecord => {
  const actor = input.actor ?? dependencies.defaultActor;

  if (actor === undefined) {
    throw new Error('Audit actor is required');
  }

  return {
    eventId: dependencies.nextId('audit'),
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    traceId: input.traceId,
    actor,
    metadata:
      input.metadata === undefined
        ? undefined
        : dependencies.redactionPolicy.sanitizeMetadata(input.metadata, {
            context: 'audit'
          }),
    redactedPayload:
      input.redactedPayload ??
      (input.metadata === undefined
        ? undefined
        : dependencies.redactionPolicy.redact(input.metadata, {
            context: 'audit'
          })),
    createdAt: input.createdAt,
    retentionUntil: dependencies.retentionPolicy.calculateAuditRetentionUntil(input.createdAt)
  };
};

export class BaseAuditEventRecorder {
  public constructor(private readonly dependencies: AuditEventRecorderDependencies) {}

  protected async recordWithPolicy(input: AuditEventRecorderInput): Promise<void> {
    await this.dependencies.save(
      buildAuditEventRecord(input, {
        nextId: this.dependencies.nextId,
        retentionPolicy: this.dependencies.retentionPolicy,
        redactionPolicy: this.dependencies.redactionPolicy,
        defaultActor: this.dependencies.defaultActor
      })
    );
  }
}
