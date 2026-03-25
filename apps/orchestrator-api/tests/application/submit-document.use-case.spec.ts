import { AuthorizationError, DEFAULT_OUTPUT_VERSION, DEFAULT_PIPELINE_VERSION, JobStatus, Role } from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, buildActor, buildUploadedFile } from '@document-parser/testkit';
import { InMemoryJobPublisherAdapter } from '../../src/adapters/out/queue/in-memory-job-publisher.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { InMemoryBinaryStorageAdapter } from '../../src/adapters/out/storage/in-memory-binary-storage.adapter';
import { Sha256HashingAdapter } from '../../src/adapters/out/storage/sha256-hashing.adapter';
import { SimplePageCounterAdapter } from '../../src/adapters/out/storage/simple-page-counter.adapter';
import { SimpleRbacAuthorizationAdapter } from '../../src/adapters/out/auth/simple-rbac.adapter';
import { SubmitDocumentUseCase } from '../../src/application/use-cases/submit-document.use-case';
import { ReprocessDocumentUseCase } from '../../src/application/use-cases/reprocess-document.use-case';
import { CompatibleResultReusePolicy } from '../../src/domain/policies/compatible-result-reuse.policy';
import { DocumentAcceptancePolicy } from '../../src/domain/policies/document-acceptance.policy';
import { RetentionPolicyService } from '../../src/domain/services/retention-policy.service';

const createSubmitDocumentUseCase = () => {
  const authorization = new SimpleRbacAuthorizationAdapter();
  const clock = new FixedClock();
  const idGenerator = new IncrementalIdGenerator();
  const hashing = new Sha256HashingAdapter();
  const pageCounter = new SimplePageCounterAdapter();
  const storage = new InMemoryBinaryStorageAdapter();
  const documents = new InMemoryDocumentRepository();
  const jobs = new InMemoryProcessingJobRepository();
  const attempts = new InMemoryJobAttemptRepository();
  const results = new InMemoryProcessingResultRepository();
  const publisher = new InMemoryJobPublisherAdapter();
  const audit = new InMemoryAuditRepository();

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
    publisher,
    audit,
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
      publisher,
      audit,
      new DocumentAcceptancePolicy(),
      new CompatibleResultReusePolicy(),
      new RetentionPolicyService()
    )
  };
};

describe('SubmitDocumentUseCase', () => {
  it('queues a new job and stores the document', async () => {
    const context = createSubmitDocumentUseCase();

    const response = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      buildActor()
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
      actor
    );

    await context.results.save({
      resultId: 'result-source',
      jobId: firstResponse.jobId,
      documentId: firstResponse.documentId,
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
      updatedAt: new Date()
    });

    const secondResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor
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
      actor
    );

    await context.results.save({
      resultId: 'result-source',
      jobId: firstResponse.jobId,
      documentId: firstResponse.documentId,
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
      updatedAt: new Date()
    });

    const secondResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'STANDARD',
        forceReprocess: true
      },
      actor
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
        buildActor({ role: Role.OPERATOR })
      )
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('ReprocessDocumentUseCase', () => {
  it('creates a new queued job that points to the original job', async () => {
    const context = createSubmitDocumentUseCase();
    const actor = buildActor();
    const initialJob = await context.useCase.execute(
      {
        file: buildUploadedFile(),
        requestedMode: 'STANDARD',
        forceReprocess: false
      },
      actor
    );

    const useCase = new ReprocessDocumentUseCase(
      context.authorization,
      context.clock,
      context.idGenerator,
      context.jobs,
      context.attempts,
      context.publisher,
      context.audit
    );

    const response = await useCase.execute(
      {
        jobId: initialJob.jobId,
        reason: 'model update'
      },
      actor
    );

    expect(response.jobId).not.toBe(initialJob.jobId);
    expect(await context.jobs.findById(response.jobId)).toMatchObject({
      status: JobStatus.QUEUED,
      reprocessOfJobId: initialJob.jobId,
      forceReprocess: true
    });
  });
});
