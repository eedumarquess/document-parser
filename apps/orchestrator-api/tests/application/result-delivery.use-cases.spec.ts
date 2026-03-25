import {
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  ExtractionWarning,
  InMemoryLoggingAdapter,
  InMemoryMetricsAdapter,
  InMemoryTracingAdapter,
  JobStatus,
  NotFoundError,
  RedactionPolicyService,
  Role
} from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, buildActor } from '@document-parser/testkit';
import { SimpleRbacAuthorizationAdapter } from '../../src/adapters/out/auth/simple-rbac.adapter';
import {
  InMemoryAuditRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { GetJobStatusUseCase } from '../../src/application/use-cases/get-job-status.use-case';
import { GetProcessingResultUseCase } from '../../src/application/use-cases/get-processing-result.use-case';
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
        metadata: {
          jobId: 'job-owner',
          documentId: 'doc-owner',
          status: JobStatus.COMPLETED
        }
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
        metadata: {
          jobId: 'job-result',
          documentId: 'doc-result'
        }
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
