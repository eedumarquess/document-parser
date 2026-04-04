import {
  AttemptStatus,
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  DEFAULT_PROCESSING_QUEUE_NAME,
  ErrorCode,
  InMemoryLoggingAdapter,
  InMemoryMetricsAdapter,
  JobStatus,
  type ProcessingJobRequestedMessage,
  QueuePublicationOutboxStatus,
  RedactionPolicyService
} from '@document-parser/shared-kernel';
import {
  createPendingAttempt,
  createSubmissionJob,
  markJobAsPublishPending,
  markJobAsStored,
  markJobAsValidated
} from '@document-parser/document-processing-domain';
import { FixedClock, IncrementalIdGenerator, buildActor } from '@document-parser/testkit';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryJobAttemptRepository,
  InMemoryProcessingJobRepository,
  InMemoryQueuePublicationOutboxRepository,
  InMemoryUnitOfWork
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { AuditEventRecorder } from '../../src/application/services/audit-event-recorder.service';
import { QueuePublicationFailureHandler } from '../../src/application/services/queue-publication-failure-handler.service';
import {
  DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME,
  QueuePublicationOutboxDispatcherService,
  buildOrchestratorQueuePublicationOutboxRecord
} from '../../src/application/services/queue-publication-outbox-dispatcher.service';
import { RetentionPolicyService } from '../../src/domain/services/retention-policy.service';

class SuccessfulPublisher {
  public readonly messages: Array<{ jobId: string; attemptId: string }> = [];

  public async publishRequested(message: ProcessingJobRequestedMessage): Promise<void> {
    this.messages.push(message);
  }

  public async publishRetry(): Promise<void> {
    throw new Error('publishRetry should not be called in orchestrator dispatcher tests');
  }
}

class FailingPublisher {
  public async publishRequested(): Promise<void> {
    throw new Error('publisher offline');
  }

  public async publishRetry(): Promise<void> {
    throw new Error('publishRetry should not be called in orchestrator dispatcher tests');
  }
}

const createDispatcherContext = (publisher: SuccessfulPublisher | FailingPublisher) => {
  const actor = buildActor();
  const clock = new FixedClock();
  const idGenerator = new IncrementalIdGenerator();
  const jobs = new InMemoryProcessingJobRepository();
  const attempts = new InMemoryJobAttemptRepository();
  const outbox = new InMemoryQueuePublicationOutboxRepository();
  const audit = new InMemoryAuditRepository();
  const logging = new InMemoryLoggingAdapter();
  const metrics = new InMemoryMetricsAdapter();
  const deadLetters = new InMemoryDeadLetterRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const retentionPolicy = new RetentionPolicyService();
  const redactionPolicy = new RedactionPolicyService();
  const auditEventRecorder = new AuditEventRecorder(audit, idGenerator, retentionPolicy, redactionPolicy);
  const failureHandler = new QueuePublicationFailureHandler(
    jobs,
    attempts,
    outbox,
    unitOfWork,
    retentionPolicy,
    auditEventRecorder
  );
  const dispatcher = new QueuePublicationOutboxDispatcherService(
    clock,
    jobs,
    attempts,
    deadLetters,
    publisher,
    outbox,
    unitOfWork,
    logging,
    metrics,
    DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME,
    retentionPolicy,
    auditEventRecorder,
    failureHandler
  );

  return {
    actor,
    clock,
    jobs,
    attempts,
    outbox,
    audit,
    dispatcher
  };
};

const seedPublishPendingJob = async (context: ReturnType<typeof createDispatcherContext>) => {
  const now = context.clock.now();
  const job = markJobAsPublishPending({
    job: markJobAsStored({
      job: markJobAsValidated({
        job: createSubmissionJob({
          jobId: 'job-dispatcher',
          documentId: 'doc-dispatcher',
          requestedMode: 'STANDARD',
          queueName: DEFAULT_PROCESSING_QUEUE_NAME,
          pipelineVersion: DEFAULT_PIPELINE_VERSION,
          outputVersion: DEFAULT_OUTPUT_VERSION,
          requestedBy: context.actor,
          forceReprocess: false,
          now
        }),
        now
      }),
      now
    }),
    now
  });
  const attempt = createPendingAttempt({
    attemptId: 'attempt-dispatcher',
    jobId: job.jobId,
    attemptNumber: 1,
    pipelineVersion: job.pipelineVersion,
    now
  });
  const outboxRecord = buildOrchestratorQueuePublicationOutboxRecord({
    outboxId: 'outbox-dispatcher',
    flowType: 'submission',
    dispatchKind: 'publish_requested',
    queueName: job.queueName,
    messageBase: {
      documentId: job.documentId,
      jobId: job.jobId,
      attemptId: attempt.attemptId,
      traceId: 'trace-dispatcher',
      requestedMode: job.requestedMode,
      pipelineVersion: job.pipelineVersion
    },
    finalizationMetadata: {
      actor: context.actor,
      auditEventType: 'PROCESSING_JOB_QUEUED',
      auditAggregateType: 'PROCESSING_JOB',
      auditAggregateId: job.jobId,
      auditMetadata: {
        jobId: job.jobId,
        attemptId: attempt.attemptId
      }
    },
    now
  });

  await context.jobs.save(job);
  await context.attempts.save(attempt);
  await context.outbox.save(outboxRecord);

  return { job, attempt, outboxRecord };
};

describe('QueuePublicationOutboxDispatcherService', () => {
  it('finalizes successful publication as QUEUED/PUBLISHED', async () => {
    const publisher = new SuccessfulPublisher();
    const context = createDispatcherContext(publisher);
    const seeded = await seedPublishPendingJob(context);

    await context.dispatcher.dispatchAvailable();

    await expect(context.jobs.findById(seeded.job.jobId)).resolves.toMatchObject({
      status: JobStatus.QUEUED,
      errorCode: undefined,
      errorMessage: undefined
    });
    const queuedAttempt = await context.attempts.findById(seeded.attempt.attemptId);
    expect(queuedAttempt).toMatchObject({
      status: AttemptStatus.QUEUED
    });
    expect(queuedAttempt).not.toHaveProperty('errorCode');

    await expect(context.outbox.findById(seeded.outboxRecord.outboxId)).resolves.toMatchObject({
      status: QueuePublicationOutboxStatus.PUBLISHED,
      publishAttempts: 1,
      lastError: undefined,
      publishedAt: expect.any(Date)
    });
    await expect(context.audit.list()).resolves.toEqual([
      expect.objectContaining({
        eventType: 'PROCESSING_JOB_QUEUED',
        traceId: 'trace-dispatcher'
      })
    ]);
  });

  it('terminalizes failed publication as FAILED without leaving the outbox claimable', async () => {
    const context = createDispatcherContext(new FailingPublisher());
    const seeded = await seedPublishPendingJob(context);

    await context.dispatcher.dispatchAvailable();

    await expect(context.jobs.findById(seeded.job.jobId)).resolves.toMatchObject({
      status: JobStatus.FAILED,
      errorCode: ErrorCode.TRANSIENT_FAILURE,
      errorMessage: 'publisher offline',
      finishedAt: expect.any(Date),
      ingestionTransitions: expect.arrayContaining([
        expect.objectContaining({
          status: JobStatus.FAILED
        })
      ])
    });
    await expect(context.attempts.findById(seeded.attempt.attemptId)).resolves.toMatchObject({
      status: AttemptStatus.FAILED,
      errorCode: ErrorCode.TRANSIENT_FAILURE,
      errorDetails: {
        message: 'publisher offline'
      },
      finishedAt: expect.any(Date)
    });
    const failedOutbox = await context.outbox.findById(seeded.outboxRecord.outboxId);
    expect(failedOutbox).toMatchObject({
      status: QueuePublicationOutboxStatus.FAILED,
      publishAttempts: 1,
      lastError: 'publisher offline',
      retentionUntil: expect.any(Date)
    });
    expect(failedOutbox).not.toHaveProperty('publishedAt');
    const [auditEvent] = await context.audit.list();
    expect(auditEvent).toMatchObject({
      eventType: 'PROCESSING_JOB_QUEUEING_FAILED',
      traceId: 'trace-dispatcher',
      metadata: expect.objectContaining({
        jobId: seeded.job.jobId,
        attemptId: seeded.attempt.attemptId,
        outboxId: seeded.outboxRecord.outboxId,
        errorCode: ErrorCode.TRANSIENT_FAILURE
      }),
      redactedPayload: expect.objectContaining({
        errorMessage: 'publisher offline'
      })
    });
    await expect(
      context.outbox.claimAvailable({
        ownerService: 'orchestrator-api',
        now: context.clock.now(),
        limit: 10,
        leaseMs: DEFAULT_QUEUE_PUBLICATION_DISPATCHER_RUNTIME.leaseMs,
        leaseOwner: 'test-claimer'
      })
    ).resolves.toEqual([]);
  });
});
