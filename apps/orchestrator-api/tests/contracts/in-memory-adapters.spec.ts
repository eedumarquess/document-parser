import { InMemoryJobPublisherAdapter } from '../../src/adapters/out/queue/in-memory-job-publisher.adapter';
import { InMemoryBinaryStorageAdapter } from '../../src/adapters/out/storage/in-memory-binary-storage.adapter';
import { SimplePageCounterAdapter } from '../../src/adapters/out/storage/simple-page-counter.adapter';

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
        requestedMode: 'STANDARD',
        pipelineVersion: 'git-sha',
        publishedAt: '2026-03-25T12:00:00.000Z'
      }
    ]);
    expect(received).toEqual(['job-1']);
  });

  it('records retry publications without exposing queue names to callers', async () => {
    const publisher = new InMemoryJobPublisherAdapter();

    await publisher.publishRetry(
      {
        documentId: 'doc-2',
        jobId: 'job-2',
        attemptId: 'attempt-2',
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
          requestedMode: 'STANDARD',
          pipelineVersion: 'git-sha',
          publishedAt: '2026-03-25T12:00:02.000Z'
        },
        retryAttempt: 2
      }
    ]);
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
});
