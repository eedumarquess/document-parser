import { AuthorizationError, DEFAULT_OUTPUT_VERSION, DEFAULT_PIPELINE_VERSION, JobStatus, Role, TransientFailureError } from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, buildActor, buildUploadedFile } from '@document-parser/testkit';
import { InMemoryJobPublisherAdapter } from '../../src/adapters/out/queue/in-memory-job-publisher.adapter';
import {
  InMemoryAuditRepository,
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
import { ReprocessDocumentUseCase } from '../../src/application/use-cases/reprocess-document.use-case';
import { CompatibleResultReusePolicy } from '../../src/domain/policies/compatible-result-reuse.policy';
import { DocumentStoragePolicy } from '../../src/domain/policies/document-storage.policy';
import { DocumentAcceptancePolicy } from '../../src/domain/policies/document-acceptance.policy';
import { PageCountPolicy } from '../../src/domain/policies/page-count.policy';
import { CompatibilityKey } from '../../src/domain/value-objects/compatibility-key';
import { RetentionPolicyService } from '../../src/domain/services/retention-policy.service';

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
    publish(message: unknown): Promise<void>;
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
  const publisher = overrides.publisher ?? new InMemoryJobPublisherAdapter();
  const audit = new InMemoryAuditRepository();
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const retentionPolicy = new RetentionPolicyService();

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
    unitOfWork,
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
      audit,
      unitOfWork,
      new DocumentAcceptancePolicy(),
      new CompatibleResultReusePolicy(),
      new PageCountPolicy(),
      new DocumentStoragePolicy(retentionPolicy)
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
      actor
    );
    const secondResponse = await context.useCase.execute(
      {
        file,
        requestedMode: 'EXPANDED',
        forceReprocess: false
      },
      actor
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
      actor
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
    await expect(context.attempts.listByJobId(secondResponse.jobId)).resolves.toEqual([]);
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

  it('marks the job as STORED and returns a transient failure when queue publication fails', async () => {
    const publisher = {
      async publish(): Promise<void> {
        throw new Error('rabbitmq unavailable');
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
        buildActor()
      )
    ).rejects.toBeInstanceOf(TransientFailureError);

    const [storedJob] = await context.jobs.list();
    expect(storedJob).toMatchObject({
      status: JobStatus.STORED,
      errorCode: 'TRANSIENT_FAILURE'
    });
    await expect(context.attempts.listByJobId(storedJob.jobId)).resolves.toEqual([]);
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
        buildActor()
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
      context.audit,
      context.unitOfWork
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
