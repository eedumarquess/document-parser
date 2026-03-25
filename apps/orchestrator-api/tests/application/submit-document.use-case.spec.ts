import {
  AuthorizationError,
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  InMemoryLoggingAdapter,
  InMemoryMetricsAdapter,
  InMemoryTracingAdapter,
  JobStatus,
  NotFoundError,
  RedactionPolicyService,
  Role,
  TransientFailureError,
  ValidationError
} from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, buildActor, buildUploadedFile } from '@document-parser/testkit';
import { InMemoryJobPublisherAdapter } from '../../src/adapters/out/queue/in-memory-job-publisher.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryUnitOfWork
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { InMemoryBinaryStorageAdapter } from '../../src/adapters/out/storage/in-memory-binary-storage.adapter';
import { Sha256HashingAdapter } from '../../src/adapters/out/storage/sha256-hashing.adapter';
import { SimplePageCounterAdapter } from '../../src/adapters/out/storage/simple-page-counter.adapter';
import { SimpleRbacAuthorizationAdapter } from '../../src/adapters/out/auth/simple-rbac.adapter';
import { SubmitDocumentUseCase } from '../../src/application/use-cases/submit-document.use-case';
import { ReplayDeadLetterUseCase } from '../../src/application/use-cases/replay-dead-letter.use-case';
import { ReprocessDocumentUseCase } from '../../src/application/use-cases/reprocess-document.use-case';
import { AuditEventRecorder } from '../../src/application/services/audit-event-recorder.service';
import { DerivedJobOrchestrator } from '../../src/application/services/derived-job-orchestrator.service';
import { QueuePublicationFailureHandler } from '../../src/application/services/queue-publication-failure-handler.service';
import { CompatibleResultReusePolicy } from '../../src/domain/policies/compatible-result-reuse.policy';
import { DocumentStoragePolicy } from '../../src/domain/policies/document-storage.policy';
import { DocumentAcceptancePolicy } from '../../src/domain/policies/document-acceptance.policy';
import { PageCountPolicy } from '../../src/domain/policies/page-count.policy';
import { CompatibilityKey } from '../../src/domain/value-objects/compatibility-key';
import { RetentionPolicyService } from '../../src/domain/services/retention-policy.service';
import type { ProcessingResultRecord } from '../../src/contracts/models';

class TrackingBinaryStorageAdapter extends InMemoryBinaryStorageAdapter {
  public lastStoredReference?: { bucket: string; objectKey: string };

  public override async storeOriginal(input: {
    documentId: string;
    mimeType: string;
    originalName: string;
    buffer: Buffer;
  }) {
    const reference = await super.storeOriginal(input);
    this.lastStoredReference = reference;
    return reference;
  }
}

class FailingUnitOfWork {
  private callCount = 0;

  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    this.callCount += 1;
    if (this.callCount === 1) {
      throw new Error('transaction exploded');
    }

    return work();
  }
}

const createSubmitDocumentUseCase = (overrides: Partial<{
  storage: InMemoryBinaryStorageAdapter;
  publisher: InMemoryJobPublisherAdapter | {
    messages?: unknown[];
    publishRequested(message: unknown): Promise<void>;
    publishRetry(message: unknown, retryAttempt: number): Promise<void>;
  };
  unitOfWork: { runInTransaction<T>(work: () => Promise<T>): Promise<T> };
}> = {}) => {
  const authorization = new SimpleRbacAuthorizationAdapter();
  const clock = new FixedClock();
  const idGenerator = new IncrementalIdGenerator();
  const hashing = new Sha256HashingAdapter();
  const pageCounter = new SimplePageCounterAdapter();
  const storage = overrides.storage ?? new InMemoryBinaryStorageAdapter();
  const documents = new InMemoryDocumentRepository();
  const jobs = new InMemoryProcessingJobRepository();
  const attempts = new InMemoryJobAttemptRepository();
  const results = new InMemoryProcessingResultRepository();
  const deadLetters = new InMemoryDeadLetterRepository();
  const publisher = overrides.publisher ?? new InMemoryJobPublisherAdapter();
  const audit = new InMemoryAuditRepository();
  const logging = new InMemoryLoggingAdapter();
  const metrics = new InMemoryMetricsAdapter();
  const tracing = new InMemoryTracingAdapter();
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const retentionPolicy = new RetentionPolicyService();
  const redactionPolicy = new RedactionPolicyService();
  const auditEventRecorder = new AuditEventRecorder(audit, idGenerator, retentionPolicy, redactionPolicy);
  const queuePublicationFailureHandler = new QueuePublicationFailureHandler(jobs, unitOfWork, auditEventRecorder);
  const derivedJobOrchestrator = new DerivedJobOrchestrator(
    idGenerator,
    jobs,
    attempts,
    publisher,
    unitOfWork,
    queuePublicationFailureHandler
  );

  return {
    authorization,
    clock,
    idGenerator,
    hashing,
    pageCounter,
    storage,
    documents,
    jobs,
    attempts,
    results,
    deadLetters,
    publisher,
    audit,
    logging,
    metrics,
    tracing,
    unitOfWork,
    retentionPolicy,
    redactionPolicy,
    auditEventRecorder,
    queuePublicationFailureHandler,
    derivedJobOrchestrator,
    useCase: new SubmitDocumentUseCase(
      authorization,
      clock,
      idGenerator,
      hashing,
      pageCounter,
      storage,
      documents,
      jobs,
      attempts,
      results,
      results,
      publisher,
      logging,
      metrics,
      tracing,
      unitOfWork,
      new DocumentAcceptancePolicy(),
      new CompatibleResultReusePolicy(),
      new PageCountPolicy(),
      new DocumentStoragePolicy(retentionPolicy),
      retentionPolicy,
      redactionPolicy,
      auditEventRecorder,
      queuePublicationFailureHandler
    )
  };
};

const createReprocessUseCase = (context: ReturnType<typeof createSubmitDocumentUseCase>) =>
  new ReprocessDocumentUseCase(
    context.authorization,
    context.clock,
    context.jobs,
    context.logging,
    context.metrics,
    context.tracing,
    context.redactionPolicy,
    context.auditEventRecorder,
    context.derivedJobOrchestrator
  );

const createReplayDeadLetterUseCase = (context: ReturnType<typeof createSubmitDocumentUseCase>) =>
  new ReplayDeadLetterUseCase(
    context.authorization,
    context.clock,
    context.deadLetters,
    context.jobs,
    context.logging,
    context.metrics,
    context.tracing,
    context.redactionPolicy,
    context.auditEventRecorder,
    context.derivedJobOrchestrator
  );

describe('SubmitDocumentUseCase', () => {
  it('queues a new job and stores the document', async () => {
    const context = createSubmitDocumentUseCase();

    const response = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      buildActor(),
      'trace-submit-new-job'
    );

    expect(response.status).toBe(JobStatus.QUEUED);
    expect(response.pipelineVersion).toBe(DEFAULT_PIPELINE_VERSION);
    expect(response.outputVersion).toBe(DEFAULT_OUTPUT_VERSION);
    expect(context.publisher.messages).toHaveLength(1);
    expect(await context.documents.findById(response.documentId)).toBeDefined();
    expect(await context.jobs.findById(response.jobId)).toMatchObject({
      status: JobStatus.QUEUED,
      reusedResult: false
    });
  });

  it('reuses the existing canonical document when the hash matches', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const file = buildUploadedFile();

    const firstResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-first'
    );
    const secondResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'EXPANDED',
        forceReprocess: false
      },
      actor,
      'trace-submit-second'
    );

    expect(secondResponse.documentId).toBe(firstResponse.documentId);
    expect(context.publisher.messages).toHaveLength(2);
  });

  it('creates a deduplicated job with reusedResult when a compatible result already exists', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const file = buildUploadedFile();
    const firstResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-compatible-source'
    );
    const compatibilityKey = CompatibilityKey.build({
      hash: await context.hashing.calculateHash(file.buffer),
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION
    });

    await context.results.save({
      resultId: 'result-source',
      jobId: firstResponse.jobId,
      documentId: firstResponse.documentId,
      compatibilityKey,
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.99,
      warnings: [],
      payload: 'resultado reutilizado',
      engineUsed: 'OCR',
      totalLatencyMs: 1000,
      createdAt: new Date(),
      updatedAt: new Date(),
      retentionUntil: new Date('2026-06-23T12:00:00.000Z')
    });

    const secondResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-compatible-reuse'
    );

    expect(secondResponse.reusedResult).toBe(true);
    expect(secondResponse.status).toBe(JobStatus.COMPLETED);
    expect(context.publisher.messages).toHaveLength(1);
    await expect(context.attempts.listByJobId(secondResponse.jobId)).resolves.toEqual([]);
  });

  it('copies technical version stamps and lineage when a compatible result is reused', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const file = buildUploadedFile();
    const sourceResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-lineage-source'
    );
    const compatibilityKey = CompatibilityKey.build({
      hash: await context.hashing.calculateHash(file.buffer),
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION
    });

    await context.results.save({
      resultId: 'result-source-lineage',
      jobId: sourceResponse.jobId,
      documentId: sourceResponse.documentId,
      compatibilityKey,
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.97,
      warnings: [],
      payload: 'resultado reutilizado',
      engineUsed: 'OCR+LLM',
      totalLatencyMs: 1200,
      promptVersion: 'prompt-v2',
      modelVersion: 'model-v3',
      normalizationVersion: 'normalization-v4',
      sourceJobId: 'job-origin',
      createdAt: new Date('2026-03-25T12:10:00.000Z'),
      updatedAt: new Date('2026-03-25T12:10:00.000Z'),
      retentionUntil: new Date('2026-06-23T12:10:00.000Z')
    });

    const reusedResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-lineage-reused'
    );

    await expect(context.jobs.findById(reusedResponse.jobId)).resolves.toMatchObject({
      sourceJobId: 'job-origin',
      sourceResultId: 'result-source-lineage',
      reusedResult: true
    });
    await expect(context.results.findByJobId(reusedResponse.jobId)).resolves.toMatchObject({
      promptVersion: 'prompt-v2',
      modelVersion: 'model-v3',
      normalizationVersion: 'normalization-v4',
      sourceJobId: 'job-origin'
    });
  });

  it('preserves the original sourceJobId across chained compatible result reuse', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const file = buildUploadedFile();
    const originalResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-chain-original'
    );
    const compatibilityKey = CompatibilityKey.build({
      hash: await context.hashing.calculateHash(file.buffer),
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION
    });

    await context.results.save({
      resultId: 'result-original-chain',
      jobId: originalResponse.jobId,
      documentId: originalResponse.documentId,
      compatibilityKey,
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.99,
      warnings: [],
      payload: 'resultado original',
      engineUsed: 'OCR',
      totalLatencyMs: 1000,
      createdAt: new Date('2026-03-25T12:00:00.000Z'),
      updatedAt: new Date('2026-03-25T12:00:00.000Z'),
      retentionUntil: new Date('2026-06-23T12:00:00.000Z')
    });

    const secondResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-chain-second'
    );
    const secondResult = await context.results.findByJobId(secondResponse.jobId);
    expect(secondResult).toBeDefined();

    expect(secondResult).toMatchObject({
      sourceJobId: originalResponse.jobId
    });
    await context.results.save({
      ...(secondResult as ProcessingResultRecord),
      createdAt: new Date('2026-03-25T12:01:00.000Z'),
      updatedAt: new Date('2026-03-25T12:01:00.000Z')
    });

    const thirdResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-chain-third'
    );

    await expect(context.jobs.findById(secondResponse.jobId)).resolves.toMatchObject({
      sourceJobId: originalResponse.jobId,
      sourceResultId: 'result-original-chain'
    });
    await expect(context.jobs.findById(thirdResponse.jobId)).resolves.toMatchObject({
      sourceJobId: originalResponse.jobId,
      sourceResultId: secondResult?.resultId
    });
    await expect(context.results.findByJobId(thirdResponse.jobId)).resolves.toMatchObject({
      sourceJobId: originalResponse.jobId
    });
    expect(context.publisher.messages).toHaveLength(1);
    await expect(context.attempts.listByJobId(secondResponse.jobId)).resolves.toEqual([]);
    await expect(context.attempts.listByJobId(thirdResponse.jobId)).resolves.toEqual([]);
  });

  it('keeps compatible reuse based only on compatibilityKey even if a persisted result carries unrelated metadata', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const file = buildUploadedFile();
    const firstResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-extra-metadata-source'
    );
    const compatibilityKey = CompatibilityKey.build({
      hash: await context.hashing.calculateHash(file.buffer),
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION
    });
    const resultWithExtraMetadata: ProcessingResultRecord & { templateId: string } = {
      resultId: 'result-source',
      jobId: firstResponse.jobId,
      documentId: firstResponse.documentId,
      compatibilityKey,
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.99,
      warnings: [],
      payload: 'resultado reutilizado',
      engineUsed: 'OCR',
      totalLatencyMs: 1000,
      createdAt: new Date(),
      updatedAt: new Date(),
      retentionUntil: new Date('2026-06-23T12:00:00.000Z'),
      templateId: 'legacy-template'
    };

    await context.results.save(resultWithExtraMetadata);

    const secondResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-extra-metadata-reuse'
    );

    expect(secondResponse.reusedResult).toBe(true);
    expect(secondResponse.status).toBe(JobStatus.COMPLETED);
    expect(context.publisher.messages).toHaveLength(1);
  });

  it('bypasses compatible reuse when forceReprocess is true', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const file = buildUploadedFile();
    const firstResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-submit-force-source'
    );
    const compatibilityKey = CompatibilityKey.build({
      hash: await context.hashing.calculateHash(file.buffer),
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION
    });

    await context.results.save({
      resultId: 'result-source',
      jobId: firstResponse.jobId,
      documentId: firstResponse.documentId,
      compatibilityKey,
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.99,
      warnings: [],
      payload: 'resultado reutilizado',
      engineUsed: 'OCR',
      totalLatencyMs: 1000,
      createdAt: new Date(),
      updatedAt: new Date(),
      retentionUntil: new Date('2026-06-23T12:00:00.000Z')
    });

    const secondResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: true
      },
      actor,
      'trace-submit-force-second'
    );

    expect(secondResponse.reusedResult).toBe(false);
    expect(context.publisher.messages).toHaveLength(2);
  });

  it('restricts submission to OWNER', async () => {
    const context = createSubmitDocumentUseCase();

    await expect(
      context.useCase.execute(
        {
          file: buildUploadedFile(),
          requestedMode: 'STANDARD',
          forceReprocess: false
        },
        buildActor({ role: Role.OPERATOR }),
        'trace-submit-forbidden'
      )
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('marks the job as STORED and returns a transient failure when queue publication fails', async () => {
    const publisher = {
      async publishRequested(): Promise<void> {
        throw new Error('rabbitmq unavailable');
      },
      async publishRetry(): Promise<void> {
        return;
      }
    };
    const context = createSubmitDocumentUseCase({ publisher });

    await expect(
      context.useCase.execute(
        {
          file: buildUploadedFile(),
          requestedMode: 'STANDARD',
          forceReprocess: false
        },
        buildActor(),
        'trace-submit-publish-failed'
      )
    ).rejects.toBeInstanceOf(TransientFailureError);

    const [storedJob] = await context.jobs.list();
    expect(storedJob).toMatchObject({
      status: JobStatus.STORED,
      errorCode: 'TRANSIENT_FAILURE'
    });
    await expect(context.attempts.listByJobId(storedJob.jobId)).resolves.toMatchObject([
      {
        status: 'PENDING'
      }
    ]);
  });

  it('deletes a newly uploaded binary when the first transaction fails', async () => {
    const storage = new TrackingBinaryStorageAdapter();
    const context = createSubmitDocumentUseCase({
      storage,
      unitOfWork: new FailingUnitOfWork()
    });

    await expect(
      context.useCase.execute(
        {
          file: buildUploadedFile(),
          requestedMode: 'STANDARD',
          forceReprocess: false
        },
        buildActor(),
        'trace-submit-transaction-failed'
      )
    ).rejects.toThrow('transaction exploded');

    expect(storage.lastStoredReference).toBeDefined();
    await expect(storage.read(storage.lastStoredReference as { bucket: string; objectKey: string })).rejects.toThrow(
      'Stored binary not found'
    );
    await expect(context.jobs.list()).resolves.toEqual([]);
  });
});

describe('ReprocessDocumentUseCase', () => {
  it('requires a non-empty reprocess reason', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const initialJob = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-reprocess-source-validation'
    );

    await expect(
      createReprocessUseCase(context).execute(
        {
          jobId: initialJob.jobId,
          reason: '   '
        },
        actor,
        'trace-reprocess-validation'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns NOT_FOUND when the original job does not exist', async () => {
    const context = createSubmitDocumentUseCase();

    await expect(
      createReprocessUseCase(context).execute(
        {
          jobId: 'missing-job',
          reason: 'model update'
        },
        buildActor(),
        'trace-reprocess-missing'
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('restricts reprocessing to OWNER', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const initialJob = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-reprocess-source-forbidden'
    );

    await expect(
      createReprocessUseCase(context).execute(
        {
          jobId: initialJob.jobId,
          reason: 'model update'
        },
        buildActor({ role: Role.OPERATOR }),
        'trace-reprocess-forbidden'
      )
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('creates a new queued job that points to the original job', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const initialJob = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-reprocess-source-success'
    );

    const response = await createReprocessUseCase(context).execute(
      {
        jobId: initialJob.jobId,
        reason: 'model update'
      },
      actor,
      'trace-reprocess-success'
    );

    expect(response.jobId).not.toBe(initialJob.jobId);
    expect(await context.jobs.findById(response.jobId)).toMatchObject({
      status: JobStatus.QUEUED,
      reprocessOfJobId: initialJob.jobId,
      forceReprocess: true
    });
    await expect(context.attempts.listByJobId(response.jobId)).resolves.toMatchObject([
      {
        status: 'QUEUED',
        attemptNumber: 1
      }
    ]);
    expect(context.publisher.messages).toHaveLength(2);
  });
});

describe('ReplayDeadLetterUseCase', () => {
  const buildDeadLetterRecord = (overrides: Partial<{
    dlqEventId: string;
    jobId: string;
    attemptId: string;
    traceId: string;
    replayedAt: Date;
  }> = {}) => ({
    dlqEventId: overrides.dlqEventId ?? 'dlq-1',
    jobId: overrides.jobId ?? 'job-1',
    attemptId: overrides.attemptId ?? 'attempt-1',
    traceId: overrides.traceId ?? 'trace-dlq-source',
    queueName: 'document-processing.requested',
    reasonCode: 'DLQ_ERROR',
    reasonMessage: 'retries exhausted',
    retryCount: 3,
    payloadSnapshot: {
      jobId: overrides.jobId ?? 'job-1',
      attemptId: overrides.attemptId ?? 'attempt-1'
    },
    firstSeenAt: new Date('2026-03-25T12:00:00.000Z'),
    lastSeenAt: new Date('2026-03-25T12:00:00.000Z'),
    replayedAt: overrides.replayedAt,
    retentionUntil: new Date('2026-09-21T12:00:00.000Z')
  });

  it('creates a new queued replay job and marks the dead letter as replayed only after publish', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const sourceJob = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-replay-source'
    );
    const [attempt] = await context.attempts.listByJobId(sourceJob.jobId);
    await context.deadLetters.save(
      buildDeadLetterRecord({
        jobId: sourceJob.jobId,
        attemptId: attempt.attemptId
      })
    );

    const response = await createReplayDeadLetterUseCase(context).execute(
      {
        dlqEventId: 'dlq-1',
        reason: 'manual replay'
      },
      actor,
      'trace-replay-success'
    );

    expect(response.jobId).not.toBe(sourceJob.jobId);
    expect(await context.jobs.findById(response.jobId)).toMatchObject({
      status: JobStatus.QUEUED,
      reprocessOfJobId: sourceJob.jobId
    });
    await expect(context.deadLetters.findById('dlq-1')).resolves.toMatchObject({
      replayedAt: expect.any(Date)
    });
    expect((context.publisher.messages ?? []).at(-1)).toMatchObject({
      jobId: response.jobId,
      traceId: 'trace-replay-success'
    });
  });

  it('returns NOT_FOUND when the dead letter does not exist', async () => {
    const context = createSubmitDocumentUseCase();

    await expect(
      createReplayDeadLetterUseCase(context).execute(
        {
          dlqEventId: 'missing-dlq',
          reason: 'manual replay'
        },
        buildActor(),
        'trace-replay-missing'
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns VALIDATION_ERROR when the dead letter was already replayed', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const sourceJob = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-replay-already-source'
    );
    const [attempt] = await context.attempts.listByJobId(sourceJob.jobId);
    await context.deadLetters.save(
      buildDeadLetterRecord({
        jobId: sourceJob.jobId,
        attemptId: attempt.attemptId,
        replayedAt: new Date('2026-03-26T12:00:00.000Z')
      })
    );

    await expect(
      createReplayDeadLetterUseCase(context).execute(
        {
          dlqEventId: 'dlq-1',
          reason: 'manual replay'
        },
        actor,
        'trace-replay-already'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps dead_letter_events unreplayed when the replay publish fails', async () => {
    let publishCount = 0;
    const publisher = {
      messages: [] as unknown[],
      async publishRequested(message: unknown): Promise<void> {
        publishCount += 1;
        if (publishCount > 1) {
          throw new Error('rabbitmq unavailable');
        }
        this.messages.push(message);
      },
      async publishRetry(): Promise<void> {
        return;
      }
    };
    const context = createSubmitDocumentUseCase({ publisher });
    const actor = buildActor();
    const sourceJob = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor,
      'trace-replay-failure-source'
    );
    const [attempt] = await context.attempts.listByJobId(sourceJob.jobId);
    await context.deadLetters.save(
      buildDeadLetterRecord({
        jobId: sourceJob.jobId,
        attemptId: attempt.attemptId
      })
    );

    await expect(
      createReplayDeadLetterUseCase(context).execute(
        {
          dlqEventId: 'dlq-1',
          reason: 'manual replay'
        },
        actor,
        'trace-replay-failure'
      )
    ).rejects.toBeInstanceOf(TransientFailureError);

    await expect(context.deadLetters.findById('dlq-1')).resolves.toMatchObject({
      replayedAt: undefined
    });
  });
});
