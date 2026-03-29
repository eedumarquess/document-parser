import {
  AttemptStatus,
  ArtifactType,
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  ExtractionWarning,
  InMemoryLoggingAdapter,
  InMemoryMetricsAdapter,
  InMemoryTracingAdapter,
  JobStatus,
  NotFoundError,
  QueuePublicationOutboxStatus,
  RedactionPolicyService,
  Role,
  type TelemetryEventRecord
} from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, buildActor } from '@document-parser/testkit';
import { SimpleRbacAuthorizationAdapter } from '../../src/adapters/out/auth/simple-rbac.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryQueuePublicationOutboxRepository,
  InMemoryTelemetryEventRepository
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { GetJobOperationalContextUseCase } from '../../src/application/use-cases/get-job-operational-context.use-case';
import { GetJobStatusUseCase } from '../../src/application/use-cases/get-job-status.use-case';
import { GetProcessingResultUseCase } from '../../src/application/use-cases/get-processing-result.use-case';
import { ArtifactPreviewService } from '../../src/application/services/artifact-preview.service';
import type { ProcessingJobRecord, ProcessingResultRecord } from '../../src/contracts/models';
import { RetentionPolicyService } from '../../src/domain/services/retention-policy.service';

const baseDate = new Date('2026-03-25T12:00:00.000Z');

const expectNoTemplateFields = (payload: Record<string, unknown>) => {
  expect(payload).not.toHaveProperty('templateId');
  expect(payload).not.toHaveProperty('templateVersion');
  expect(payload).not.toHaveProperty('templateStatus');
  expect(payload).not.toHaveProperty('matchingRules');
};

const buildJobRecord = (overrides: Partial<ProcessingJobRecord> = {}): ProcessingJobRecord => {
  const createdAt = overrides.createdAt ?? baseDate;

  return {
    jobId: overrides.jobId ?? 'job-1',
    documentId: overrides.documentId ?? 'doc-1',
    requestedMode: overrides.requestedMode ?? 'STANDARD',
    priority: overrides.priority ?? 'NORMAL',
    queueName: overrides.queueName ?? 'document-processing.requested',
    status: overrides.status ?? JobStatus.QUEUED,
    forceReprocess: overrides.forceReprocess ?? false,
    reusedResult: overrides.reusedResult ?? false,
    sourceJobId: overrides.sourceJobId,
    sourceResultId: overrides.sourceResultId,
    reprocessOfJobId: overrides.reprocessOfJobId,
    pipelineVersion: overrides.pipelineVersion ?? DEFAULT_PIPELINE_VERSION,
    outputVersion: overrides.outputVersion ?? DEFAULT_OUTPUT_VERSION,
    acceptedAt: overrides.acceptedAt ?? createdAt,
    queuedAt: overrides.queuedAt,
    startedAt: overrides.startedAt,
    finishedAt: overrides.finishedAt,
    requestedBy: overrides.requestedBy ?? buildActor(),
    warnings: overrides.warnings ?? [],
    errorCode: overrides.errorCode,
    errorMessage: overrides.errorMessage,
    ingestionTransitions: overrides.ingestionTransitions ?? [],
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt
  };
};

const buildResultRecord = (overrides: Partial<ProcessingResultRecord> = {}): ProcessingResultRecord => {
  const createdAt = overrides.createdAt ?? baseDate;

  return {
    resultId: overrides.resultId ?? 'result-1',
    jobId: overrides.jobId ?? 'job-1',
    documentId: overrides.documentId ?? 'doc-1',
    compatibilityKey:
      overrides.compatibilityKey ??
      `hash:${overrides.requestedMode ?? 'STANDARD'}:${DEFAULT_PIPELINE_VERSION}:${DEFAULT_OUTPUT_VERSION}`,
    status: overrides.status ?? JobStatus.COMPLETED,
    requestedMode: overrides.requestedMode ?? 'STANDARD',
    pipelineVersion: overrides.pipelineVersion ?? DEFAULT_PIPELINE_VERSION,
    outputVersion: overrides.outputVersion ?? DEFAULT_OUTPUT_VERSION,
    confidence: overrides.confidence ?? 0.98,
    warnings: overrides.warnings ?? [],
    payload: overrides.payload ?? 'texto consolidado',
    engineUsed: overrides.engineUsed ?? 'OCR',
    totalLatencyMs: overrides.totalLatencyMs ?? 900,
    promptVersion: overrides.promptVersion,
    modelVersion: overrides.modelVersion,
    normalizationVersion: overrides.normalizationVersion,
    sourceJobId: overrides.sourceJobId,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    retentionUntil: overrides.retentionUntil ?? new Date('2026-06-23T12:00:00.000Z')
  };
};

const createResultDeliveryContext = () => {
  const authorization = new SimpleRbacAuthorizationAdapter();
  const clock = new FixedClock();
  const idGenerator = new IncrementalIdGenerator();
  const jobs = new InMemoryProcessingJobRepository();
  const results = new InMemoryProcessingResultRepository();
  const audit = new InMemoryAuditRepository();
  const logging = new InMemoryLoggingAdapter();
  const metrics = new InMemoryMetricsAdapter();
  const tracing = new InMemoryTracingAdapter();
  const retentionPolicy = new RetentionPolicyService();
  const redactionPolicy = new RedactionPolicyService();

  return {
    audit,
    logging,
    metrics,
    tracing,
    jobs,
    results,
    getJobStatus: new GetJobStatusUseCase(
      authorization,
      clock,
      idGenerator,
      jobs,
      audit,
      logging,
      metrics,
      tracing,
      retentionPolicy,
      redactionPolicy
    ),
    getProcessingResult: new GetProcessingResultUseCase(
      authorization,
      clock,
      idGenerator,
      jobs,
      results,
      audit,
      logging,
      metrics,
      tracing,
      retentionPolicy,
      redactionPolicy
    )
  };
};

const createOperationalContext = () => {
  const authorization = new SimpleRbacAuthorizationAdapter();
  const clock = new FixedClock();
  const idGenerator = new IncrementalIdGenerator();
  const jobs = new InMemoryProcessingJobRepository();
  const attempts = new InMemoryJobAttemptRepository();
  const results = new InMemoryProcessingResultRepository();
  const artifacts = new InMemoryPageArtifactRepository();
  const deadLetters = new InMemoryDeadLetterRepository();
  const outbox = new InMemoryQueuePublicationOutboxRepository();
  const audit = new InMemoryAuditRepository();
  const telemetry = new InMemoryTelemetryEventRepository();
  const logging = new InMemoryLoggingAdapter();
  const metrics = new InMemoryMetricsAdapter();
  const tracing = new InMemoryTracingAdapter();
  const retentionPolicy = new RetentionPolicyService();
  const redactionPolicy = new RedactionPolicyService();
  const artifactPreviewService = new ArtifactPreviewService(redactionPolicy);

  return {
    jobs,
    attempts,
    results,
    artifacts,
    deadLetters,
    outbox,
    audit,
    telemetry,
    logging,
    metrics,
    tracing,
    useCase: new GetJobOperationalContextUseCase(
      authorization,
      clock,
      idGenerator,
      jobs,
      attempts,
      results,
      artifacts,
      deadLetters,
      outbox,
      audit,
      telemetry,
      logging,
      metrics,
      tracing,
      retentionPolicy,
      redactionPolicy,
      artifactPreviewService
    )
  };
};

describe('GetJobStatusUseCase', () => {
  it('returns the minimal job response for OWNER', async () => {
    const context = createResultDeliveryContext();
    const job = buildJobRecord({
      jobId: 'job-owner',
      documentId: 'doc-owner',
      status: JobStatus.COMPLETED
    });
    await context.jobs.save(job);

    const response = await context.getJobStatus.execute({ jobId: job.jobId }, buildActor(), 'trace-status-owner');

    expect(response).toEqual({
      jobId: 'job-owner',
      documentId: 'doc-owner',
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      reusedResult: false,
      createdAt: baseDate.toISOString()
    });
    expect(Object.keys(response).sort()).toEqual(
      ['createdAt', 'documentId', 'jobId', 'outputVersion', 'pipelineVersion', 'requestedMode', 'reusedResult', 'status'].sort()
    );
    expectNoTemplateFields(response);
    await expect(context.audit.list()).resolves.toEqual([
      expect.objectContaining({
        eventType: 'JOB_STATUS_QUERIED',
        traceId: 'trace-status-owner',
        metadata: expect.objectContaining({
          jobId: 'job-owner',
          documentId: 'doc-owner',
          status: JobStatus.COMPLETED
        })
      })
    ]);
  });

  it('allows OPERATOR to read a reused result job', async () => {
    const context = createResultDeliveryContext();
    const job = buildJobRecord({
      jobId: 'job-reused',
      documentId: 'doc-reused',
      status: JobStatus.PARTIAL,
      reusedResult: true
    });
    await context.jobs.save(job);

    const response = await context.getJobStatus.execute(
      { jobId: job.jobId },
      buildActor({ role: Role.OPERATOR }),
      'trace-status-operator'
    );

    expect(response).toEqual({
      jobId: 'job-reused',
      documentId: 'doc-reused',
      status: JobStatus.PARTIAL,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      reusedResult: true,
      createdAt: baseDate.toISOString()
    });
    expectNoTemplateFields(response);
  });

  it('returns FAILED when the job terminated before queue publication completed', async () => {
    const context = createResultDeliveryContext();
    const job = buildJobRecord({
      jobId: 'job-queue-failed',
      documentId: 'doc-queue-failed',
      status: JobStatus.FAILED,
      errorCode: 'TRANSIENT_FAILURE',
      errorMessage: 'publisher offline',
      finishedAt: new Date('2026-03-25T12:01:00.000Z'),
      ingestionTransitions: [
        { status: JobStatus.RECEIVED, at: new Date('2026-03-25T12:00:00.000Z') },
        { status: JobStatus.PUBLISH_PENDING, at: new Date('2026-03-25T12:00:30.000Z') },
        { status: JobStatus.FAILED, at: new Date('2026-03-25T12:01:00.000Z') }
      ]
    });
    await context.jobs.save(job);

    const response = await context.getJobStatus.execute(
      { jobId: job.jobId },
      buildActor({ role: Role.OPERATOR }),
      'trace-status-failed-queue-publication'
    );

    expect(response).toEqual({
      jobId: 'job-queue-failed',
      documentId: 'doc-queue-failed',
      status: JobStatus.FAILED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      reusedResult: false,
      createdAt: baseDate.toISOString()
    });
    expectNoTemplateFields(response);
  });

  it('returns NOT_FOUND when the job does not exist', async () => {
    const context = createResultDeliveryContext();
    const promise = context.getJobStatus.execute({ jobId: 'missing-job' }, buildActor(), 'trace-status-missing');

    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      metadata: {
        jobId: 'missing-job'
      }
    });
  });
});

describe('GetProcessingResultUseCase', () => {
  it('returns the minimal result response and records RESULT_QUERIED', async () => {
    const context = createResultDeliveryContext();
    const actor = buildActor({ actorId: 'operator-1', role: Role.OPERATOR });
    const job = buildJobRecord({
      jobId: 'job-result',
      documentId: 'doc-result',
      status: JobStatus.COMPLETED
    });
    const result = buildResultRecord({
      jobId: job.jobId,
      documentId: job.documentId
    });
    await context.jobs.save(job);
    await context.results.save(result);

    const response = await context.getProcessingResult.execute({ jobId: job.jobId }, actor, 'trace-result-success');

    expect(response).toEqual({
      jobId: 'job-result',
      documentId: 'doc-result',
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.98,
      warnings: [],
      payload: 'texto consolidado'
    });
    expect(Object.keys(response).sort()).toEqual(
      ['confidence', 'documentId', 'jobId', 'outputVersion', 'payload', 'pipelineVersion', 'requestedMode', 'status', 'warnings'].sort()
    );
    expectNoTemplateFields(response);

    await expect(context.audit.list()).resolves.toEqual([
      expect.objectContaining({
        eventType: 'RESULT_QUERIED',
        traceId: 'trace-result-success',
        actor,
        metadata: expect.objectContaining({
          jobId: 'job-result',
          documentId: 'doc-result'
        })
      })
    ]);
    expect(context.logging.entries.at(-1)).toMatchObject({
      traceId: 'trace-result-success',
      data: expect.objectContaining({
        payload: '[REDACTED]'
      })
    });
  });

  it('returns PARTIAL with warnings when the persisted result is incomplete', async () => {
    const context = createResultDeliveryContext();
    const job = buildJobRecord({
      jobId: 'job-partial',
      documentId: 'doc-partial',
      status: JobStatus.PARTIAL
    });
    const result = buildResultRecord({
      jobId: job.jobId,
      documentId: job.documentId,
      status: JobStatus.PARTIAL,
      confidence: 0.62,
      warnings: [ExtractionWarning.ILLEGIBLE_CONTENT],
      payload: 'Paciente consciente. Observacao manuscrita: [ilegivel].'
    });
    await context.jobs.save(job);
    await context.results.save(result);

    const response = await context.getProcessingResult.execute(
      { jobId: job.jobId },
      buildActor(),
      'trace-result-partial'
    );

    expect(response).toEqual({
      jobId: 'job-partial',
      documentId: 'doc-partial',
      status: JobStatus.PARTIAL,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.62,
      warnings: [ExtractionWarning.ILLEGIBLE_CONTENT],
      payload: 'Paciente consciente. Observacao manuscrita: [ilegivel].'
    });
    expectNoTemplateFields(response);
  });

  it('returns NOT_FOUND when the job does not exist', async () => {
    const context = createResultDeliveryContext();
    const promise = context.getProcessingResult.execute(
      { jobId: 'missing-job' },
      buildActor({ role: Role.OPERATOR }),
      'trace-result-missing-job'
    );

    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      metadata: {
        jobId: 'missing-job'
      }
    });
  });

  it('returns NOT_FOUND when the job exists but no result is persisted yet', async () => {
    const context = createResultDeliveryContext();
    const job = buildJobRecord({
      jobId: 'job-without-result',
      documentId: 'doc-without-result',
      status: JobStatus.FAILED
    });
    await context.jobs.save(job);
    const promise = context.getProcessingResult.execute(
      { jobId: job.jobId },
      buildActor({ role: Role.OPERATOR }),
      'trace-result-missing-result'
    );

    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      metadata: {
        jobId: 'job-without-result'
      }
    });
  });
});

describe('GetJobOperationalContextUseCase', () => {
  it('aggregates job context, telemetry and redacted artifact previews for a completed job', async () => {
    const context = createOperationalContext();
    const job = buildJobRecord({
      jobId: 'job-ops',
      documentId: 'doc-ops',
      status: JobStatus.COMPLETED,
      queuedAt: new Date('2026-03-25T12:01:00.000Z'),
      startedAt: new Date('2026-03-25T12:02:00.000Z'),
      finishedAt: new Date('2026-03-25T12:03:00.000Z'),
      ingestionTransitions: [
        { status: JobStatus.RECEIVED, at: new Date('2026-03-25T12:00:00.000Z') },
        { status: JobStatus.QUEUED, at: new Date('2026-03-25T12:01:00.000Z') }
      ]
    });
    await context.jobs.save(job);
    await context.attempts.save({
      attemptId: 'attempt-ops-1',
      jobId: job.jobId,
      attemptNumber: 1,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      status: AttemptStatus.COMPLETED,
      fallbackUsed: true,
      fallbackReason: 'CHECKBOX_AMBIGUOUS',
      promptVersion: 'prompt-v1',
      modelVersion: 'model-v1',
      normalizationVersion: 'norm-v1',
      latencyMs: 980,
      startedAt: new Date('2026-03-25T12:02:00.000Z'),
      finishedAt: new Date('2026-03-25T12:03:00.000Z'),
      createdAt: new Date('2026-03-25T12:01:00.000Z')
    });
    await context.results.save(
      buildResultRecord({
        jobId: job.jobId,
        documentId: job.documentId,
        engineUsed: 'OCR+LLM'
      })
    );
    await context.outbox.save({
      outboxId: 'outbox-ops-1',
      ownerService: 'orchestrator-api',
      flowType: 'submission',
      dispatchKind: 'publish_requested',
      jobId: job.jobId,
      documentId: job.documentId,
      attemptId: 'attempt-ops-1',
      queueName: job.queueName,
      messageBase: {
        documentId: job.documentId,
        jobId: job.jobId,
        attemptId: 'attempt-ops-1',
        traceId: 'trace-ops-1',
        requestedMode: job.requestedMode,
        pipelineVersion: job.pipelineVersion
      },
      finalizationMetadata: {
        auditEventType: 'PROCESSING_JOB_QUEUED'
      },
      status: QueuePublicationOutboxStatus.PUBLISHED,
      publishAttempts: 1,
      availableAt: new Date('2026-03-25T12:01:00.000Z'),
      publishedAt: new Date('2026-03-25T12:01:05.000Z'),
      createdAt: new Date('2026-03-25T12:01:00.000Z'),
      updatedAt: new Date('2026-03-25T12:01:05.000Z'),
      retentionUntil: new Date('2026-04-01T12:01:05.000Z')
    });
    await context.audit.record({
      eventId: 'audit-ops-1',
      eventType: 'PROCESSING_JOB_QUEUED',
      aggregateType: 'PROCESSING_JOB',
      aggregateId: job.jobId,
      traceId: 'trace-ops-1',
      actor: buildActor(),
      metadata: { jobId: job.jobId, documentId: job.documentId },
      redactedPayload: { jobId: job.jobId },
      createdAt: new Date('2026-03-25T12:01:00.000Z'),
      retentionUntil: new Date('2026-09-21T12:00:00.000Z')
    });
    await context.artifacts.saveMany([
      {
        artifactId: 'artifact-ops-ocr',
        artifactType: ArtifactType.OCR_JSON,
        storageBucket: 'artifacts',
        storageObjectKey: 'ocr/job-ops/page-1.json',
        mimeType: 'application/json',
        pageNumber: 1,
        metadata: {
          rawText: 'cpf 123.456.789-00 email paciente@example.com'
        },
        documentId: job.documentId,
        jobId: job.jobId,
        createdAt: new Date('2026-03-25T12:03:00.000Z'),
        retentionUntil: new Date('2026-06-23T12:00:00.000Z')
      },
      {
        artifactId: 'artifact-ops-prompt',
        artifactType: ArtifactType.LLM_PROMPT,
        storageBucket: 'artifacts',
        storageObjectKey: 'llm/job-ops/prompt-1.json',
        mimeType: 'application/json',
        pageNumber: 1,
        metadata: {
          promptText: 'cpf 123.456.789-00 bearer sk_live_super_secret_token_1234567890'
        },
        documentId: job.documentId,
        jobId: job.jobId,
        createdAt: new Date('2026-03-25T12:03:10.000Z'),
        retentionUntil: new Date('2026-06-23T12:00:00.000Z')
      },
      {
        artifactId: 'artifact-ops-response',
        artifactType: ArtifactType.LLM_RESPONSE,
        storageBucket: 'artifacts',
        storageObjectKey: 'llm/job-ops/response-1.json',
        mimeType: 'application/json',
        pageNumber: 1,
        metadata: {
          responseText: 'email paciente@example.com bearer sk_live_super_secret_token_1234567890'
        },
        documentId: job.documentId,
        jobId: job.jobId,
        createdAt: new Date('2026-03-25T12:03:20.000Z'),
        retentionUntil: new Date('2026-06-23T12:00:00.000Z')
      }
    ]);

    const telemetryEvent: TelemetryEventRecord = {
      telemetryEventId: 'telemetry-ops-1',
      kind: 'span',
      serviceName: 'document-parser-worker',
      traceId: 'trace-ops-1',
      jobId: job.jobId,
      documentId: job.documentId,
      attemptId: 'attempt-ops-1',
      operation: 'extraction',
      spanName: 'worker.extraction',
      attributes: { jobId: job.jobId, operation: 'extraction' },
      startedAt: new Date('2026-03-25T12:02:10.000Z'),
      endedAt: new Date('2026-03-25T12:02:40.000Z'),
      status: 'ok',
      occurredAt: new Date('2026-03-25T12:02:40.000Z'),
      retentionUntil: new Date('2026-04-24T12:00:00.000Z')
    };
    await context.telemetry.save(telemetryEvent);

    const response = await context.useCase.execute(
      { jobId: job.jobId },
      buildActor({ role: Role.OPERATOR }),
      'trace-ops-query'
    );

    expect(response.summary).toMatchObject({
      jobId: job.jobId,
      documentId: job.documentId,
      status: JobStatus.COMPLETED
    });
    expect(response.traceIds).toEqual(['trace-ops-1']);
    expect(response.queuePublication).toMatchObject({
      outboxId: 'outbox-ops-1',
      status: 'PUBLISHED',
      ownerService: 'orchestrator-api',
      flowType: 'submission',
      dispatchKind: 'publish_requested',
      publishAttempts: 1
    });
    expect(response.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactId: 'artifact-ops-ocr',
          previewText: 'cpf [cpf] email [email]',
          metadata: undefined
        }),
        expect.objectContaining({
          artifactId: 'artifact-ops-prompt',
          previewText: 'cpf [cpf] [token]',
          metadata: undefined
        }),
        expect.objectContaining({
          artifactId: 'artifact-ops-response',
          previewText: 'email [email] [token]',
          metadata: undefined
        })
      ])
    );
    expect(response.telemetryEvents).toEqual([
      expect.objectContaining({
        telemetryEventId: 'telemetry-ops-1',
        serviceName: 'document-parser-worker',
        kind: 'span',
        attemptId: 'attempt-ops-1'
      })
    ]);
    expect(response.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'telemetry',
          title: 'document-parser-worker span'
        }),
        expect.objectContaining({
          source: 'outbox',
          title: 'Queue publication PUBLISHED'
        }),
        expect.objectContaining({
          source: 'result',
          title: `Result ${JobStatus.COMPLETED}`
        })
      ])
    );
  });

  it('includes retries and terminal dead-letter records in the operational context', async () => {
    const context = createOperationalContext();
    const job = buildJobRecord({
      jobId: 'job-ops-dlq',
      documentId: 'doc-ops-dlq',
      status: JobStatus.FAILED,
      warnings: [ExtractionWarning.ILLEGIBLE_CONTENT]
    });
    await context.jobs.save(job);
    await context.attempts.save({
      attemptId: 'attempt-ops-dlq-1',
      jobId: job.jobId,
      attemptNumber: 1,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      status: AttemptStatus.FAILED,
      fallbackUsed: false,
      errorCode: 'TRANSIENT_FAILURE',
      createdAt: new Date('2026-03-25T12:00:00.000Z')
    });
    await context.attempts.save({
      attemptId: 'attempt-ops-dlq-2',
      jobId: job.jobId,
      attemptNumber: 2,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      status: AttemptStatus.MOVED_TO_DLQ,
      fallbackUsed: false,
      errorCode: 'FATAL_FAILURE',
      createdAt: new Date('2026-03-25T12:02:00.000Z')
    });
    await context.deadLetters.save({
      dlqEventId: 'dlq-ops-1',
      jobId: job.jobId,
      attemptId: 'attempt-ops-dlq-2',
      traceId: 'trace-ops-dlq-1',
      queueName: 'document-processing.requested',
      reasonCode: 'FATAL_FAILURE',
      reasonMessage: 'retries exhausted',
      retryCount: 2,
      payloadSnapshot: { jobId: job.jobId },
      firstSeenAt: new Date('2026-03-25T12:03:00.000Z'),
      lastSeenAt: new Date('2026-03-25T12:03:00.000Z'),
      retentionUntil: new Date('2026-09-21T12:00:00.000Z')
    });
    await context.telemetry.save({
      telemetryEventId: 'telemetry-ops-dlq-1',
      kind: 'metric',
      serviceName: 'document-parser-worker',
      traceId: 'trace-ops-dlq-1',
      jobId: job.jobId,
      documentId: job.documentId,
      attemptId: 'attempt-ops-dlq-2',
      operation: 'failure_recovery',
      metricKind: 'counter',
      name: 'worker.process_job_message.failed',
      value: 1,
      tags: {
        jobId: job.jobId,
        attemptId: 'attempt-ops-dlq-2',
        operation: 'failure_recovery'
      },
      occurredAt: new Date('2026-03-25T12:03:00.000Z'),
      retentionUntil: new Date('2026-04-24T12:00:00.000Z')
    });

    const response = await context.useCase.execute(
      { jobId: job.jobId },
      buildActor(),
      'trace-ops-dlq-query'
    );

    expect(response.deadLetters).toEqual([
      expect.objectContaining({
        dlqEventId: 'dlq-ops-1',
        reasonCode: 'FATAL_FAILURE'
      })
    ]);
    expect(response.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attemptId: 'attempt-ops-dlq-1', status: 'FAILED' }),
        expect.objectContaining({ attemptId: 'attempt-ops-dlq-2', status: 'MOVED_TO_DLQ' })
      ])
    );
    expect(response.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'dead_letter',
          title: 'DLQ FATAL_FAILURE'
        })
      ])
    );
  });

  it('surfaces terminal queue-publication failures in the operational context', async () => {
    const context = createOperationalContext();
    const job = buildJobRecord({
      jobId: 'job-ops-queue-failed',
      documentId: 'doc-ops-queue-failed',
      status: JobStatus.FAILED,
      errorCode: 'TRANSIENT_FAILURE',
      errorMessage: 'publisher offline',
      finishedAt: new Date('2026-03-25T12:01:00.000Z'),
      ingestionTransitions: [
        { status: JobStatus.RECEIVED, at: new Date('2026-03-25T12:00:00.000Z') },
        { status: JobStatus.PUBLISH_PENDING, at: new Date('2026-03-25T12:00:30.000Z') },
        { status: JobStatus.FAILED, at: new Date('2026-03-25T12:01:00.000Z') }
      ]
    });
    await context.jobs.save(job);
    await context.attempts.save({
      attemptId: 'attempt-ops-queue-failed',
      jobId: job.jobId,
      attemptNumber: 1,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      status: AttemptStatus.FAILED,
      fallbackUsed: false,
      errorCode: 'TRANSIENT_FAILURE',
      errorDetails: {
        message: 'publisher offline'
      },
      finishedAt: new Date('2026-03-25T12:01:00.000Z'),
      createdAt: new Date('2026-03-25T12:00:30.000Z')
    });
    await context.outbox.save({
      outboxId: 'outbox-ops-queue-failed',
      ownerService: 'orchestrator-api',
      flowType: 'submission',
      dispatchKind: 'publish_requested',
      jobId: job.jobId,
      documentId: job.documentId,
      attemptId: 'attempt-ops-queue-failed',
      queueName: job.queueName,
      messageBase: {
        documentId: job.documentId,
        jobId: job.jobId,
        attemptId: 'attempt-ops-queue-failed',
        traceId: 'trace-ops-queue-failed',
        requestedMode: job.requestedMode,
        pipelineVersion: job.pipelineVersion
      },
      finalizationMetadata: {
        auditEventType: 'PROCESSING_JOB_QUEUED'
      },
      status: QueuePublicationOutboxStatus.FAILED,
      publishAttempts: 1,
      availableAt: new Date('2026-03-25T12:00:30.000Z'),
      lastError: 'publisher offline',
      createdAt: new Date('2026-03-25T12:00:30.000Z'),
      updatedAt: new Date('2026-03-25T12:01:00.000Z'),
      retentionUntil: new Date('2026-04-01T12:01:00.000Z')
    });
    await context.audit.record({
      eventId: 'audit-ops-queue-failed',
      eventType: 'PROCESSING_JOB_QUEUEING_FAILED',
      aggregateType: 'PROCESSING_JOB',
      aggregateId: job.jobId,
      traceId: 'trace-ops-queue-failed',
      actor: buildActor(),
      metadata: {
        jobId: job.jobId,
        attemptId: 'attempt-ops-queue-failed',
        outboxId: 'outbox-ops-queue-failed',
        errorCode: 'TRANSIENT_FAILURE'
      },
      redactedPayload: {
        jobId: job.jobId
      },
      createdAt: new Date('2026-03-25T12:01:00.000Z'),
      retentionUntil: new Date('2026-09-21T12:00:00.000Z')
    });

    const response = await context.useCase.execute(
      { jobId: job.jobId },
      buildActor({ role: Role.OPERATOR }),
      'trace-ops-queue-failed-query'
    );

    expect(response.summary).toMatchObject({
      jobId: job.jobId,
      documentId: job.documentId,
      status: JobStatus.FAILED,
      errorCode: 'TRANSIENT_FAILURE',
      errorMessage: 'publisher offline'
    });
    expect(response.queuePublication).toMatchObject({
      outboxId: 'outbox-ops-queue-failed',
      status: QueuePublicationOutboxStatus.FAILED,
      publishAttempts: 1,
      lastError: 'publisher offline'
    });
    expect(response.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'job',
          title: `Job ${JobStatus.FAILED}`
        }),
        expect.objectContaining({
          source: 'outbox',
          title: `Queue publication ${QueuePublicationOutboxStatus.FAILED}`
        }),
        expect.objectContaining({
          source: 'audit',
          title: 'PROCESSING_JOB_QUEUEING_FAILED'
        })
      ])
    );
  });
});
