import { Test } from '@nestjs/testing';
import { AttemptStatus, DEFAULT_OUTPUT_VERSION, DEFAULT_PIPELINE_VERSION, JobStatus, Role } from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, InMemoryPublishedMessageBus, buildActor } from '@document-parser/testkit';
import { DocumentProcessingWorkerModule } from '../../src/app.module';
import { ProcessingJobConsumer } from '../../src/adapters/in/queue/processing-job.consumer';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository
} from '../../src/adapters/out/repositories/in-memory.repositories';

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

describe('DocumentProcessingWorkerModule e2e', () => {
  it('processes a queued message inside the Nest application context', async () => {
    const clock = new FixedClock();
    const idGenerator = new IncrementalIdGenerator();
    const storage = new LocalBinaryStorage();
    const documents = new InMemoryDocumentRepository();
    const jobs = new InMemoryProcessingJobRepository();
    const attempts = new InMemoryJobAttemptRepository();
    const results = new InMemoryProcessingResultRepository();
    const artifacts = new InMemoryPageArtifactRepository();
    const deadLetters = new InMemoryDeadLetterRepository();
    const audit = new InMemoryAuditRepository();
    const publisher = new InMemoryPublishedMessageBus();

    const storageReference = await storage.storeOriginal({
      documentId: 'doc-1',
      originalName: 'sample.txt',
      buffer: Buffer.from('worker flow')
    });
    await documents.save({
      documentId: 'doc-1',
      hash: 'sha256:doc',
      originalFileName: 'sample.txt',
      mimeType: 'text/plain',
      fileSizeBytes: 10,
      pageCount: 1,
      sourceType: 'MULTIPART',
      storageReference,
      retentionUntil: new Date('2026-04-25T12:00:00.000Z'),
      createdAt: clock.now(),
      updatedAt: clock.now()
    });
    await jobs.save({
      jobId: 'job-1',
      documentId: 'doc-1',
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
      attemptId: 'attempt-1',
      jobId: 'job-1',
      attemptNumber: 1,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      status: AttemptStatus.QUEUED,
      fallbackUsed: false,
      createdAt: clock.now()
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        DocumentProcessingWorkerModule.register({
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
          publisher
        })
      ]
    }).compile();

    const consumer = moduleRef.get(ProcessingJobConsumer);
    await consumer.handle({
      documentId: 'doc-1',
      jobId: 'job-1',
      attemptId: 'attempt-1',
      traceId: 'trace-worker-e2e-1',
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      publishedAt: clock.now().toISOString()
    });

    expect(await results.findByJobId('job-1')).toMatchObject({
      status: JobStatus.COMPLETED
    });
    expect(await artifacts.listByJobId('job-1')).toHaveLength(2);
  });
});
