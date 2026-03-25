import { AttemptStatus, DEFAULT_OUTPUT_VERSION, DEFAULT_PIPELINE_VERSION, ErrorCode, JobStatus, Role } from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, InMemoryPublishedMessageBus, buildActor } from '@document-parser/testkit';
import { ProcessJobMessageUseCase } from '../../src/application/use-cases/process-job-message.use-case';
import { SimulatedDocumentExtractionAdapter } from '../../src/adapters/out/extraction/simulated-document-extraction.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { ProcessingOutcomePolicy } from '../../src/domain/policies/processing-outcome.policy';
import { RetryPolicyService } from '../../src/domain/policies/retry-policy.service';

class LocalBinaryStorage {
  private readonly objects = new Map<string, Buffer>();

  public async storeOriginal(input: {
    documentId: string;
    originalName: string;
    buffer: Buffer;
  }): Promise<{ bucket: string; objectKey: string }> {
    const objectKey = `original/${input.documentId}/${input.originalName}`;
    this.objects.set(objectKey, Buffer.from(input.buffer));
    return { bucket: 'documents', objectKey };
  }

  public async read(reference: { objectKey: string }): Promise<Buffer> {
    const stored = this.objects.get(reference.objectKey);
    if (stored === undefined) {
      throw new Error('missing binary');
    }
    return Buffer.from(stored);
  }
}

const createWorkerContext = async (buffer: Buffer, attemptNumber = 1) => {
  const clock = new FixedClock();
  const idGenerator = new IncrementalIdGenerator();
  const documentId = idGenerator.next('doc');
  const jobId = idGenerator.next('job');
  const attemptId = idGenerator.next('attempt');
  const storage = new LocalBinaryStorage();
  const documents = new InMemoryDocumentRepository();
  const jobs = new InMemoryProcessingJobRepository();
  const attempts = new InMemoryJobAttemptRepository();
  const results = new InMemoryProcessingResultRepository();
  const artifacts = new InMemoryPageArtifactRepository();
  const deadLetters = new InMemoryDeadLetterRepository();
  const audit = new InMemoryAuditRepository();
  const publisher = new InMemoryPublishedMessageBus();
  const extraction = new SimulatedDocumentExtractionAdapter(new ProcessingOutcomePolicy());

  const storageReference = await storage.storeOriginal({
    documentId,
    originalName: 'sample.pdf',
    buffer
  });

  await documents.save({
    documentId,
    hash: 'sha256:doc',
    originalFileName: 'sample.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: buffer.byteLength,
    pageCount: 1,
    sourceType: 'MULTIPART',
    storageReference,
    retentionUntil: new Date('2026-04-25T12:00:00.000Z'),
    createdAt: clock.now(),
    updatedAt: clock.now()
  });
  await jobs.save({
    jobId,
    documentId,
    requestedMode: 'STANDARD',
    priority: 'NORMAL',
    queueName: 'document-processing.requested',
    status: JobStatus.QUEUED,
    forceReprocess: false,
    reusedResult: false,
    pipelineVersion: DEFAULT_PIPELINE_VERSION,
    outputVersion: DEFAULT_OUTPUT_VERSION,
    acceptedAt: clock.now(),
    queuedAt: clock.now(),
    requestedBy: buildActor({ role: Role.OWNER }),
    warnings: [],
    ingestionTransitions: [{ status: JobStatus.QUEUED, at: clock.now() }],
    createdAt: clock.now(),
    updatedAt: clock.now()
  });
  await attempts.save({
    attemptId,
    jobId,
    attemptNumber,
    pipelineVersion: DEFAULT_PIPELINE_VERSION,
    status: AttemptStatus.QUEUED,
    fallbackUsed: false,
    createdAt: clock.now()
  });

  return {
    documentId,
    jobId,
    attemptId,
    clock,
    idGenerator,
    storage,
    documents,
    jobs,
    attempts,
    results,
    artifacts,
    deadLetters,
    audit,
    publisher,
    extraction,
    useCase: new ProcessJobMessageUseCase(
      clock,
      idGenerator,
      storage,
      documents,
      jobs,
      attempts,
      results,
      artifacts,
      deadLetters,
      audit,
      publisher,
      extraction,
      new RetryPolicyService()
    )
  };
};

describe('ProcessJobMessageUseCase', () => {
  it('processes a successful job and stores result plus artifacts', async () => {
    const context = await createWorkerContext(Buffer.from('%PDF-1.4\n/Type /Page\nconteudo'));

    await context.useCase.execute({
      message: {
        documentId: context.documentId,
        jobId: context.jobId,
        attemptId: context.attemptId,
        requestedMode: 'STANDARD',
        pipelineVersion: DEFAULT_PIPELINE_VERSION,
        publishedAt: context.clock.now().toISOString()
      }
    });

    expect(await context.results.findByJobId(context.jobId)).toMatchObject({
      status: JobStatus.COMPLETED
    });
    expect(await context.jobs.findById(context.jobId)).toMatchObject({
      status: JobStatus.COMPLETED
    });
    expect(await context.artifacts.listByJobId(context.jobId)).toHaveLength(3);
  });

  it('retries transient failures and republishes a new attempt', async () => {
    const context = await createWorkerContext(Buffer.from('%PDF-1.4\n/Type /Page\n[[TRANSIENT_FAILURE]]'));

    await context.useCase.execute({
      message: {
        documentId: context.documentId,
        jobId: context.jobId,
        attemptId: context.attemptId,
        requestedMode: 'STANDARD',
        pipelineVersion: DEFAULT_PIPELINE_VERSION,
        publishedAt: context.clock.now().toISOString()
      }
    });

    expect(await context.jobs.findById(context.jobId)).toMatchObject({
      status: JobStatus.QUEUED
    });
    expect(context.publisher.messages).toHaveLength(1);
    expect(await context.attempts.findById(context.attemptId)).toMatchObject({
      status: AttemptStatus.FAILED,
      errorCode: ErrorCode.TRANSIENT_FAILURE
    });
  });

  it('sends terminal failures to DLQ when retries are exhausted', async () => {
    const context = await createWorkerContext(Buffer.from('%PDF-1.4\n/Type /Page\n[[TRANSIENT_FAILURE]]'), 3);

    await context.useCase.execute({
      message: {
        documentId: context.documentId,
        jobId: context.jobId,
        attemptId: context.attemptId,
        requestedMode: 'STANDARD',
        pipelineVersion: DEFAULT_PIPELINE_VERSION,
        publishedAt: context.clock.now().toISOString()
      }
    });

    expect(await context.jobs.findById(context.jobId)).toMatchObject({
      status: JobStatus.FAILED
    });
    expect(await context.deadLetters.list()).toHaveLength(1);
    expect(context.publisher.messages).toHaveLength(0);
  });
});
