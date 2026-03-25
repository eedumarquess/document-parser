import {
  AttemptStatus,
  JobStatus,
  RedactionPolicyService,
  RetentionPolicyService,
  Role,
  TransientFailureError
} from '@document-parser/shared-kernel';
import { IncrementalIdGenerator, InMemoryPublishedMessageBus } from '@document-parser/testkit';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryJobAttemptRepository,
  InMemoryProcessingJobRepository,
  InMemoryUnitOfWork
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { AuditEventRecorder } from '../../src/application/services/audit-event-recorder.service';
import { ProcessingFailureRecoveryService } from '../../src/application/services/processing-failure-recovery.service';
import { RetryPolicyService } from '../../src/domain/policies/retry-policy.service';

const createContext = async (attemptNumber = 1) => {
  const idGenerator = new IncrementalIdGenerator();
  const jobs = new InMemoryProcessingJobRepository();
  const attempts = new InMemoryJobAttemptRepository();
  const deadLetters = new InMemoryDeadLetterRepository();
  const audit = new InMemoryAuditRepository();
  const retentionPolicy = new RetentionPolicyService();
  const redactionPolicy = new RedactionPolicyService();
  const publisher = new InMemoryPublishedMessageBus();
  const now = new Date('2026-03-25T12:00:00.000Z');
  idGenerator.next('doc');
  idGenerator.next('job');
  idGenerator.next('attempt');

  await jobs.save({
    jobId: 'job-1',
    documentId: 'doc-1',
    requestedMode: 'STANDARD',
    priority: 'NORMAL',
    queueName: 'document-processing.requested',
    status: JobStatus.PROCESSING,
    forceReprocess: false,
    reusedResult: false,
    pipelineVersion: 'git-sha',
    outputVersion: '1.0.0',
    acceptedAt: now,
    startedAt: now,
    requestedBy: { actorId: 'owner-1', role: Role.OWNER },
    warnings: [],
    ingestionTransitions: [{ status: JobStatus.QUEUED, at: now }],
    createdAt: now,
    updatedAt: now
  });
  await attempts.save({
    attemptId: 'attempt-1',
    jobId: 'job-1',
    attemptNumber,
    pipelineVersion: 'git-sha',
    status: AttemptStatus.PROCESSING,
    fallbackUsed: false,
    createdAt: now,
    startedAt: now
  });

  return {
    idGenerator,
    jobs,
    attempts,
    deadLetters,
    audit,
    publisher,
    retentionPolicy,
    redactionPolicy,
    unitOfWork: new InMemoryUnitOfWork(),
    now
  };
};

describe('ProcessingFailureRecoveryService', () => {
  it('schedules a retry and persists both failed and queued attempts', async () => {
    const context = await createContext();
    const service = new ProcessingFailureRecoveryService(
      context.idGenerator,
      context.jobs,
      context.attempts,
      context.deadLetters,
      context.publisher,
      context.unitOfWork,
      new RetryPolicyService(),
      context.retentionPolicy,
      context.redactionPolicy,
      new AuditEventRecorder(
        context.audit,
        context.idGenerator,
        context.retentionPolicy,
        context.redactionPolicy
      )
    );

    await expect(
      service.recover({
        error: new TransientFailureError('temporary outage'),
        context: {
          message: {
            documentId: 'doc-1',
            jobId: 'job-1',
            attemptId: 'attempt-1',
            traceId: 'trace-retry',
            requestedMode: 'STANDARD',
            pipelineVersion: 'git-sha',
            publishedAt: context.now.toISOString()
          },
          document: {
            documentId: 'doc-1',
            hash: 'sha256:doc',
            originalFileName: 'sample.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 100,
            pageCount: 1,
            sourceType: 'MULTIPART',
            storageReference: { bucket: 'documents', objectKey: 'original/doc-1/sample.pdf' },
            retentionUntil: context.now,
            createdAt: context.now,
            updatedAt: context.now
          },
          job: (await context.jobs.findById('job-1'))!,
          attempt: (await context.attempts.findById('attempt-1'))!
        },
        now: context.now
      })
    ).resolves.toBe('retry_scheduled');

    await expect(context.jobs.findById('job-1')).resolves.toMatchObject({
      status: JobStatus.QUEUED
    });
    await expect(context.attempts.listByJobId('job-1')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptId: 'attempt-1',
          status: AttemptStatus.FAILED
        }),
        expect.objectContaining({
          attemptNumber: 2,
          status: AttemptStatus.QUEUED
        })
      ])
    );
    expect(context.publisher.messages).toHaveLength(1);
    await expect(context.audit.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PROCESSING_RETRY_SCHEDULED'
        })
      ])
    );
  });

  it('moves the flow directly to DLQ when retry publication fails', async () => {
    const context = await createContext();
    const publisher = {
      async publishRequested(): Promise<void> {
        return;
      },
      async publishRetry(): Promise<void> {
        throw new Error('retry bus down');
      }
    };
    const service = new ProcessingFailureRecoveryService(
      context.idGenerator,
      context.jobs,
      context.attempts,
      context.deadLetters,
      publisher,
      context.unitOfWork,
      new RetryPolicyService(),
      context.retentionPolicy,
      context.redactionPolicy,
      new AuditEventRecorder(
        context.audit,
        context.idGenerator,
        context.retentionPolicy,
        context.redactionPolicy
      )
    );

    await expect(
      service.recover({
        error: new TransientFailureError('temporary outage'),
        context: {
          message: {
            documentId: 'doc-1',
            jobId: 'job-1',
            attemptId: 'attempt-1',
            traceId: 'trace-retry-publish-failed',
            requestedMode: 'STANDARD',
            pipelineVersion: 'git-sha',
            publishedAt: context.now.toISOString()
          },
          document: {
            documentId: 'doc-1',
            hash: 'sha256:doc',
            originalFileName: 'sample.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 100,
            pageCount: 1,
            sourceType: 'MULTIPART',
            storageReference: { bucket: 'documents', objectKey: 'original/doc-1/sample.pdf' },
            retentionUntil: context.now,
            createdAt: context.now,
            updatedAt: context.now
          },
          job: (await context.jobs.findById('job-1'))!,
          attempt: (await context.attempts.findById('attempt-1'))!
        },
        now: context.now
      })
    ).rejects.toThrow('retry bus down');

    await expect(context.jobs.findById('job-1')).resolves.toMatchObject({
      status: JobStatus.FAILED,
      errorCode: 'DLQ_ERROR'
    });
    await expect(context.attempts.listByJobId('job-1')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptId: 'attempt-1',
          status: AttemptStatus.FAILED
        }),
        expect.objectContaining({
          attemptNumber: 2,
          status: AttemptStatus.MOVED_TO_DLQ,
          errorCode: 'DLQ_ERROR'
        })
      ])
    );
    await expect(context.deadLetters.list()).resolves.toEqual([
      expect.objectContaining({
        traceId: 'trace-retry-publish-failed',
        reasonCode: 'DLQ_ERROR'
      })
    ]);
  });
});
