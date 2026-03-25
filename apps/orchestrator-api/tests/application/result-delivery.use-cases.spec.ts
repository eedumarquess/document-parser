import {
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  ExtractionWarning,
  JobStatus,
  NotFoundError,
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

const baseDate = new Date('2026-03-25T12:00:00.000Z');

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
    updatedAt: overrides.updatedAt ?? createdAt
  };
};

const createResultDeliveryContext = () => {
  const authorization = new SimpleRbacAuthorizationAdapter();
  const clock = new FixedClock();
  const idGenerator = new IncrementalIdGenerator();
  const jobs = new InMemoryProcessingJobRepository();
  const results = new InMemoryProcessingResultRepository();
  const audit = new InMemoryAuditRepository();

  return {
    audit,
    jobs,
    results,
    getJobStatus: new GetJobStatusUseCase(authorization, jobs),
    getProcessingResult: new GetProcessingResultUseCase(authorization, clock, idGenerator, jobs, results, audit)
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

    await expect(context.getJobStatus.execute({ jobId: job.jobId }, buildActor())).resolves.toEqual({
      jobId: 'job-owner',
      documentId: 'doc-owner',
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      reusedResult: false,
      createdAt: baseDate.toISOString()
    });
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

    await expect(
      context.getJobStatus.execute({ jobId: job.jobId }, buildActor({ role: Role.OPERATOR }))
    ).resolves.toEqual({
      jobId: 'job-reused',
      documentId: 'doc-reused',
      status: JobStatus.PARTIAL,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      reusedResult: true,
      createdAt: baseDate.toISOString()
    });
  });

  it('returns NOT_FOUND when the job does not exist', async () => {
    const context = createResultDeliveryContext();
    const promise = context.getJobStatus.execute({ jobId: 'missing-job' }, buildActor());

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

    await expect(context.getProcessingResult.execute({ jobId: job.jobId }, actor)).resolves.toEqual({
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

    await expect(context.audit.list()).resolves.toEqual([
      expect.objectContaining({
        eventType: 'RESULT_QUERIED',
        actor,
        metadata: {
          jobId: 'job-result',
          documentId: 'doc-result'
        }
      })
    ]);
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

    await expect(context.getProcessingResult.execute({ jobId: job.jobId }, buildActor())).resolves.toEqual({
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
  });

  it('returns NOT_FOUND when the job does not exist', async () => {
    const context = createResultDeliveryContext();
    const promise = context.getProcessingResult.execute(
      { jobId: 'missing-job' },
      buildActor({ role: Role.OPERATOR })
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
      buildActor({ role: Role.OPERATOR })
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
