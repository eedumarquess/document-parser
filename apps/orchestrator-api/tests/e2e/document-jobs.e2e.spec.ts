import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  ExtractionWarning,
  JobStatus,
  Role
} from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, createPdfBuffer } from '@document-parser/testkit';
import { OrchestratorApiModule } from '../../src/app.module';
import { InMemoryJobPublisherAdapter } from '../../src/adapters/out/queue/in-memory-job-publisher.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { InMemoryBinaryStorageAdapter } from '../../src/adapters/out/storage/in-memory-binary-storage.adapter';

describe('Document jobs e2e', () => {
  let app: INestApplication;

  const waitForJobStatus = async (jobId: string, expectedStatus: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(app.getHttpServer())
        .get(`/v1/parsing/jobs/${jobId}`)
        .set('x-role', Role.OWNER);

      if (response.body.status === expectedStatus) {
        return response;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Job ${jobId} did not reach status ${expectedStatus}`);
  };

  beforeAll(async () => {
    const clock = new FixedClock();
    const idGenerator = new IncrementalIdGenerator();
    const storage = new InMemoryBinaryStorageAdapter();
    const documents = new InMemoryDocumentRepository();
    const jobs = new InMemoryProcessingJobRepository();
    const attempts = new InMemoryJobAttemptRepository();
    const results = new InMemoryProcessingResultRepository();
    const audit = new InMemoryAuditRepository();
    const publisher = new InMemoryJobPublisherAdapter();
    publisher.subscribe(async (message) => {
      const document = await documents.findById(message.documentId);
      const job = await jobs.findById(message.jobId);
      if (document === undefined || job === undefined) {
        throw new Error('worker simulation missing context');
      }

      const original = await storage.read(document.storageReference);
      const rawText = original.toString('utf8').trim();
      const payload = rawText.includes('[[ILLEGIBLE]]') ? '[ilegivel]' : rawText;
      const status = payload.includes('[ilegivel]') ? JobStatus.PARTIAL : JobStatus.COMPLETED;

      await jobs.save({
        ...job,
        status,
        warnings: status === JobStatus.PARTIAL ? [ExtractionWarning.ILLEGIBLE_CONTENT] : [],
        finishedAt: clock.now(),
        updatedAt: clock.now()
      });
      await results.save({
        resultId: idGenerator.next('result'),
        jobId: job.jobId,
        documentId: job.documentId,
        compatibilityKey: `${document.hash}:${job.requestedMode}:${DEFAULT_PIPELINE_VERSION}:${DEFAULT_OUTPUT_VERSION}`,
        status,
        requestedMode: job.requestedMode,
        pipelineVersion: DEFAULT_PIPELINE_VERSION,
        outputVersion: DEFAULT_OUTPUT_VERSION,
        confidence: status === JobStatus.COMPLETED ? 0.98 : 0.62,
        warnings: status === JobStatus.PARTIAL ? [ExtractionWarning.ILLEGIBLE_CONTENT] : [],
        payload,
        engineUsed: 'OCR',
        totalLatencyMs: 900,
        createdAt: clock.now(),
        updatedAt: clock.now()
      });
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        OrchestratorApiModule.register({
          clock,
          idGenerator,
          storage,
          documents,
          jobs,
          attempts,
          results,
          audit,
          publisher
        })
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts an upload, exposes status and returns the minimal result contract', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .set('x-role', Role.OWNER)
      .attach('file', createPdfBuffer(1, 'conteudo extraido'), {
        filename: 'sample.pdf',
        contentType: 'application/pdf'
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.status).toBe('QUEUED');

    const statusResponse = await waitForJobStatus(createResponse.body.jobId, 'COMPLETED');

    expect(statusResponse.body.status).toBe('COMPLETED');

    const resultResponse = await request(app.getHttpServer())
      .get(`/v1/parsing/jobs/${createResponse.body.jobId}/result`)
      .set('x-role', Role.OPERATOR);

    expect(resultResponse.status).toBe(200);
    expect(resultResponse.body).toMatchObject({
      jobId: createResponse.body.jobId,
      documentId: createResponse.body.documentId,
      status: 'COMPLETED',
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: '1.0.0',
      payload: expect.stringContaining('conteudo extraido')
    });
  });

  it('returns PARTIAL with [ilegivel] when the pipeline marks content as illegible', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .set('x-role', Role.OWNER)
      .attach('file', createPdfBuffer(1, '[[ILLEGIBLE]]'), {
        filename: 'partial.pdf',
        contentType: 'application/pdf'
      });

    await waitForJobStatus(createResponse.body.jobId, 'PARTIAL');

    const resultResponse = await request(app.getHttpServer())
      .get(`/v1/parsing/jobs/${createResponse.body.jobId}/result`)
      .set('x-role', Role.OPERATOR);

    expect(resultResponse.body.status).toBe('PARTIAL');
    expect(resultResponse.body.payload).toContain('[ilegivel]');
  });

  it('allows OPERATOR to read but blocks reprocessing', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .set('x-role', Role.OWNER)
      .attach('file', createPdfBuffer(1, 'reprocess me'), {
        filename: 'reprocess.pdf',
        contentType: 'application/pdf'
      });

    const statusResponse = await request(app.getHttpServer())
      .get(`/v1/parsing/jobs/${createResponse.body.jobId}`)
      .set('x-role', Role.OPERATOR);

    expect(statusResponse.status).toBe(200);

    const forbiddenResponse = await request(app.getHttpServer())
      .post(`/v1/parsing/jobs/${createResponse.body.jobId}/reprocess`)
      .set('x-role', Role.OPERATOR)
      .send({ reason: 'not allowed' });

    expect(forbiddenResponse.status).toBe(403);
  });
});
