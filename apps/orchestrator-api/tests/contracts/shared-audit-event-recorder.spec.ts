import {
  buildAuditEventRecord,
  RetentionPolicyService,
  RedactionPolicyService,
  Role
} from '@document-parser/shared-kernel';

describe('Shared audit event recorder', () => {
  it('builds an audit record using the explicit actor and shared redaction rules', () => {
    const createdAt = new Date('2026-03-25T12:00:00.000Z');

    const record = buildAuditEventRecord(
      {
        eventType: 'DOCUMENT_ACCEPTED',
        aggregateType: 'PROCESSING_JOB',
        aggregateId: 'job-1',
        traceId: 'trace-1',
        actor: {
          actorId: 'owner-1',
          role: Role.OWNER
        },
        metadata: {
          jobId: 'job-1',
          note: 'email paciente@example.com'
        },
        createdAt
      },
      {
        nextId: () => 'audit-1',
        retentionPolicy: new RetentionPolicyService(),
        redactionPolicy: new RedactionPolicyService()
      }
    );

    expect(record).toEqual({
      eventId: 'audit-1',
      eventType: 'DOCUMENT_ACCEPTED',
      aggregateType: 'PROCESSING_JOB',
      aggregateId: 'job-1',
      traceId: 'trace-1',
      actor: {
        actorId: 'owner-1',
        role: Role.OWNER
      },
      metadata: {
        jobId: 'job-1',
        note: '[REDACTED]'
      },
      redactedPayload: {
        jobId: 'job-1',
        note: 'email [email]'
      },
      createdAt,
      retentionUntil: new Date('2026-09-21T12:00:00.000Z')
    });
  });

  it('uses the configured default actor when the input omits actor', () => {
    const record = buildAuditEventRecord(
      {
        eventType: 'PROCESSING_COMPLETED',
        traceId: 'trace-worker',
        createdAt: new Date('2026-03-25T12:00:00.000Z')
      },
      {
        nextId: () => 'audit-2',
        retentionPolicy: new RetentionPolicyService(),
        redactionPolicy: new RedactionPolicyService(),
        defaultActor: {
          actorId: 'document-processing-worker',
          role: Role.OWNER
        }
      }
    );

    expect(record.actor).toEqual({
      actorId: 'document-processing-worker',
      role: Role.OWNER
    });
  });

  it('fails fast when no actor is provided and no default policy exists', () => {
    expect(() =>
      buildAuditEventRecord(
        {
          eventType: 'PROCESSING_COMPLETED',
          traceId: 'trace-missing-actor',
          createdAt: new Date('2026-03-25T12:00:00.000Z')
        },
        {
          nextId: () => 'audit-3',
          retentionPolicy: new RetentionPolicyService(),
          redactionPolicy: new RedactionPolicyService()
        }
      )
    ).toThrow('Audit actor is required');
  });
});
