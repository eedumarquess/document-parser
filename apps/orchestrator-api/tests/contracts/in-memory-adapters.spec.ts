import { JobStatus } from '@document-parser/shared-kernel';
import { InMemoryJobPublisherAdapter } from '../../src/adapters/out/queue/in-memory-job-publisher.adapter';
import { InMemoryProcessingResultRepository } from '../../src/adapters/out/repositories/in-memory.repositories';
import { InMemoryBinaryStorageAdapter } from '../../src/adapters/out/storage/in-memory-binary-storage.adapter';
import { SimplePageCounterAdapter } from '../../src/adapters/out/storage/simple-page-counter.adapter';

const expectNoTemplateFields = (payload: Record<string, unknown>) => {
  expect(payload).not.toHaveProperty('templateId');
  expect(payload).not.toHaveProperty('templateVersion');
  expect(payload).not.toHaveProperty('templateStatus');
  expect(payload).not.toHaveProperty('matchingRules');
};

describe('In-memory adapter contracts', () => {
  it('stores and retrieves the original binary without mutation', async () => {
    const storage = new InMemoryBinaryStorageAdapter();
    const input = Buffer.from('%PDF-1.4\n/Type /Page\nhello');
    const reference = await storage.storeOriginal({
      documentId: 'doc-1',
      mimeType: 'application/pdf',
      originalName: 'sample.pdf',
      buffer: input
    });

    await expect(storage.read(reference)).resolves.toEqual(input);
  });

  it('publishes the minimal queue contract and notifies subscribers', async () => {
    const publisher = new InMemoryJobPublisherAdapter();
    const received: string[] = [];
    publisher.subscribe(async (message) => {
      received.push(message.jobId);
    });

    await publisher.publishRequested({
      documentId: 'doc-1',
      jobId: 'job-1',
      attemptId: 'attempt-1',
      traceId: 'trace-1',
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      publishedAt: new Date('2026-03-25T12:00:00.000Z').toISOString()
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(publisher.messages).toEqual([
      {
        documentId: 'doc-1',
        jobId: 'job-1',
        attemptId: 'attempt-1',
        traceId: 'trace-1',
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        publishedAt: '2026-03-25T12:00:00.000Z'
      }
    ]);
    expect(Object.keys(publisher.messages[0]).sort()).toEqual(
      ['attemptId', 'documentId', 'jobId', 'pipelineVersion', 'publishedAt', 'requestedMode', 'traceId'].sort()
    );
    expectNoTemplateFields(publisher.messages[0] as Record<string, unknown>);
    expect(received).toEqual(['job-1']);
  });

  it('records retry publications without exposing queue names to callers', async () => {
    const publisher = new InMemoryJobPublisherAdapter();

    await publisher.publishRetry(
      {
        documentId: 'doc-2',
        jobId: 'job-2',
        attemptId: 'attempt-2',
        traceId: 'trace-2',
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        publishedAt: '2026-03-25T12:00:02.000Z'
      },
      2
    );

    expect(publisher.retryMessages).toEqual([
      {
        message: {
          documentId: 'doc-2',
          jobId: 'job-2',
          attemptId: 'attempt-2',
          traceId: 'trace-2',
          requestedMode: 'STANDARD',
          pipelineVersion: 'git-sha',
          publishedAt: '2026-03-25T12:00:02.000Z'
        },
        retryAttempt: 2
      }
    ]);
    expect(Object.keys(publisher.retryMessages[0].message).sort()).toEqual(
      ['attemptId', 'documentId', 'jobId', 'pipelineVersion', 'publishedAt', 'requestedMode', 'traceId'].sort()
    );
    expectNoTemplateFields(publisher.retryMessages[0].message as Record<string, unknown>);
  });

  it('counts PDF pages from the uploaded binary', async () => {
    const counter = new SimplePageCounterAdapter();

    await expect(
      counter.countPages({
        originalName: 'sample.pdf',
        mimeType: 'application/pdf',
        size: 100,
        buffer: Buffer.from('%PDF-1.4\n/Type /Page\n/Type /Page\nhello')
      })
    ).resolves.toBe(2);
  });

  it('keeps a single logical processing result per jobId', async () => {
    const repository = new InMemoryProcessingResultRepository();

    await repository.save({
      resultId: 'result-1',
      jobId: 'job-1',
      documentId: 'doc-1',
      compatibilityKey: 'compatibility-1',
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      outputVersion: '1.0.0',
      confidence: 0.8,
      warnings: [],
      payload: 'old payload',
      engineUsed: 'OCR',
      totalLatencyMs: 100,
      createdAt: new Date('2026-03-25T12:00:00.000Z'),
      updatedAt: new Date('2026-03-25T12:00:00.000Z'),
      retentionUntil: new Date('2026-06-23T12:00:00.000Z')
    });
    await repository.save({
      resultId: 'result-2',
      jobId: 'job-1',
      documentId: 'doc-1',
      compatibilityKey: 'compatibility-1',
      status: JobStatus.PARTIAL,
      requestedMode: 'STANDARD',
      pipelineVersion: 'git-sha',
      outputVersion: '1.0.0',
      confidence: 0.9,
      warnings: ['ILLEGIBLE_CONTENT'],
      payload: 'new payload',
      engineUsed: 'OCR+LLM',
      totalLatencyMs: 120,
      createdAt: new Date('2026-03-25T12:01:00.000Z'),
      updatedAt: new Date('2026-03-25T12:01:00.000Z'),
      retentionUntil: new Date('2026-06-23T12:01:00.000Z')
    });

    await expect(repository.findByJobId('job-1')).resolves.toMatchObject({
      resultId: 'result-2',
      payload: 'new payload',
      status: JobStatus.PARTIAL
    });
  });
});
