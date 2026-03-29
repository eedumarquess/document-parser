import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  ArtifactType,
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  ExtractionWarning,
  JobStatus,
  Role,
  type ProcessingJobRequestedMessage
} from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, createPdfBuffer } from '@document-parser/testkit';
import { OrchestratorApiModule } from '../../src/app.module';
import { InMemoryJobPublisherAdapter } from '../../src/adapters/out/queue/in-memory-job-publisher.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryTelemetryEventRepository
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { InMemoryBinaryStorageAdapter } from '../../src/adapters/out/storage/in-memory-binary-storage.adapter';

class FailingJobPublisherAdapter extends InMemoryJobPublisherAdapter {
  public override async publishRequested(_message: ProcessingJobRequestedMessage): Promise<void> {
    throw new Error('publisher offline');
  }

  public override async publishRetry(
    _message: ProcessingJobRequestedMessage,
    _retryAttempt: number
  ): Promise<void> {
    throw new Error('publisher offline');
  }
}

const expectNoTemplateFields = (payload: Record<string, unknown>) => {
  expect(payload).not.toHaveProperty('templateId');
  expect(payload).not.toHaveProperty('templateVersion');
  expect(payload).not.toHaveProperty('templateStatus');
  expect(payload).not.toHaveProperty('matchingRules');
};

describe('Document jobs e2e', () => {
  let app: INestApplication;
  let audit: InMemoryAuditRepository;
  let deadLetters: InMemoryDeadLetterRepository;
  let jobs: InMemoryProcessingJobRepository;
  let attempts: InMemoryJobAttemptRepository;
  let artifacts: InMemoryPageArtifactRepository;
  let telemetry: InMemoryTelemetryEventRepository;
  let lastPublishedTraceId: string | undefined;

  const waitForJobStatus = async (
    jobId: string,
    expectedStatus: string,
    appInstance: INestApplication = app
  ) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const response = await request(appInstance.getHttpServer())
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
    jobs = new InMemoryProcessingJobRepository();
    attempts = new InMemoryJobAttemptRepository();
    const results = new InMemoryProcessingResultRepository();
    artifacts = new InMemoryPageArtifactRepository();
    deadLetters = new InMemoryDeadLetterRepository();
    audit = new InMemoryAuditRepository();
    telemetry = new InMemoryTelemetryEventRepository();
    const publisher = new InMemoryJobPublisherAdapter();
    publisher.subscribe(async (message) => {
      lastPublishedTraceId = message.traceId;
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
        updatedAt: clock.now(),
        retentionUntil: new Date('2026-06-23T12:00:00.000Z')
      });
      await artifacts.saveMany([
        {
          artifactId: `artifact-ocr-${job.jobId}`,
          artifactType: ArtifactType.OCR_JSON,
          storageBucket: 'artifacts',
          storageObjectKey: `ocr/${job.jobId}/page-1.json`,
          mimeType: 'application/json',
          pageNumber: 1,
          metadata: {
            rawText: 'cpf 123.456.789-00 email paciente@example.com'
          },
          documentId: document.documentId,
          jobId: job.jobId,
          createdAt: clock.now(),
          retentionUntil: new Date('2026-06-23T12:00:00.000Z')
        },
        {
          artifactId: `artifact-prompt-${job.jobId}`,
          artifactType: ArtifactType.LLM_PROMPT,
          storageBucket: 'artifacts',
          storageObjectKey: `llm/${job.jobId}/prompt-1.json`,
          mimeType: 'application/json',
          pageNumber: 1,
          metadata: {
            promptText: 'cpf 123.456.789-00 bearer sk_live_super_secret_token_1234567890'
          },
          documentId: document.documentId,
          jobId: job.jobId,
          createdAt: clock.now(),
          retentionUntil: new Date('2026-06-23T12:00:00.000Z')
        },
        {
          artifactId: `artifact-response-${job.jobId}`,
          artifactType: ArtifactType.LLM_RESPONSE,
          storageBucket: 'artifacts',
          storageObjectKey: `llm/${job.jobId}/response-1.json`,
          mimeType: 'application/json',
          pageNumber: 1,
          metadata: {
            responseText: 'email paciente@example.com bearer sk_live_super_secret_token_1234567890'
          },
          documentId: document.documentId,
          jobId: job.jobId,
          createdAt: clock.now(),
          retentionUntil: new Date('2026-06-23T12:00:00.000Z')
        }
      ]);
      await telemetry.save({
        telemetryEventId: `telemetry-${job.jobId}`,
        kind: 'span',
        serviceName: 'document-parser-worker',
        traceId: message.traceId,
        jobId: job.jobId,
        documentId: document.documentId,
        attemptId: message.attemptId,
        operation: 'extraction',
        spanName: 'worker.extraction',
        attributes: {
          jobId: job.jobId,
          documentId: document.documentId,
          attemptId: message.attemptId,
          operation: 'extraction'
        },
        startedAt: clock.now(),
        endedAt: clock.now(),
        status: 'ok',
        occurredAt: clock.now(),
        retentionUntil: new Date('2026-04-24T12:00:00.000Z')
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
          artifacts,
          deadLetters,
          audit,
          telemetry,
          publisher,
          queuePublicationDispatcherRuntime: {
            pollIntervalMs: 10,
            batchSize: 20,
            leaseMs: 30_000
          }
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
      .set('x-trace-id', 'trace-e2e-submit')
      .attach('file', createPdfBuffer(1, 'conteudo extraido'), {
        filename: 'sample.pdf',
        contentType: 'application/pdf'
      });

    expect(createResponse.status).toBe(202);
    expect(createResponse.headers['x-trace-id']).toBe('trace-e2e-submit');
    expect(createResponse.body.status).toBe('PUBLISH_PENDING');
    expect(Object.keys(createResponse.body).sort()).toEqual(
      ['createdAt', 'documentId', 'jobId', 'outputVersion', 'pipelineVersion', 'requestedMode', 'reusedResult', 'status'].sort()
    );
    expectNoTemplateFields(createResponse.body);

    const statusResponse = await waitForJobStatus(createResponse.body.jobId, 'COMPLETED');

    expect(lastPublishedTraceId).toBe('trace-e2e-submit');
    expect(statusResponse.body.status).toBe('COMPLETED');
    expect(statusResponse.headers['x-trace-id']).toBeDefined();
    expect(Object.keys(statusResponse.body).sort()).toEqual(
      ['createdAt', 'documentId', 'jobId', 'outputVersion', 'pipelineVersion', 'requestedMode', 'reusedResult', 'status'].sort()
    );
    expectNoTemplateFields(statusResponse.body);

    const resultResponse = await request(app.getHttpServer())
      .get(`/v1/parsing/jobs/${createResponse.body.jobId}/result`)
      .set('x-role', Role.OPERATOR);

    expect(resultResponse.status).toBe(200);
    expect(resultResponse.headers['x-trace-id']).toBeDefined();
    expect(resultResponse.body).toMatchObject({
      jobId: createResponse.body.jobId,
      documentId: createResponse.body.documentId,
      status: 'COMPLETED',
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: '1.0.0',
      payload: expect.stringContaining('conteudo extraido')
    });
    expect(Object.keys(resultResponse.body).sort()).toEqual(
      ['confidence', 'documentId', 'jobId', 'outputVersion', 'payload', 'pipelineVersion', 'requestedMode', 'status', 'warnings'].sort()
    );
    expectNoTemplateFields(resultResponse.body);
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
    expectNoTemplateFields(resultResponse.body);
  });

  it('returns the validation error envelope when the upload is missing', async () => {
    const response = await request(app.getHttpServer()).post('/v1/parsing/jobs');

    expect(response.status).toBe(400);
    expect(response.headers['x-trace-id']).toBeDefined();
    expect(response.body).toEqual({
      errorCode: 'VALIDATION_ERROR',
      message: 'file is required'
    });
  });

  it('returns the not found error envelope for an unknown job', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/parsing/jobs/job-missing')
      .set('x-role', Role.OPERATOR);

    expect(response.status).toBe(404);
    expect(response.headers['x-trace-id']).toBeDefined();
    expect(response.body).toEqual({
      errorCode: 'NOT_FOUND',
      message: 'Processing job not found',
      metadata: {
        jobId: 'job-missing'
      }
    });
  });

  it('converges to FAILED when orchestrator queue publication fails', async () => {
    const clock = new FixedClock();
    const idGenerator = new IncrementalIdGenerator();
    const failingAppJobs = new InMemoryProcessingJobRepository();
    const failingApp = (
      await Test.createTestingModule({
        imports: [
          OrchestratorApiModule.register({
            clock,
            idGenerator,
            storage: new InMemoryBinaryStorageAdapter(),
            documents: new InMemoryDocumentRepository(),
            jobs: failingAppJobs,
            attempts: new InMemoryJobAttemptRepository(),
            results: new InMemoryProcessingResultRepository(),
            artifacts: new InMemoryPageArtifactRepository(),
            deadLetters: new InMemoryDeadLetterRepository(),
            audit: new InMemoryAuditRepository(),
            telemetry: new InMemoryTelemetryEventRepository(),
            publisher: new FailingJobPublisherAdapter(),
            queuePublicationDispatcherRuntime: {
              pollIntervalMs: 10,
              batchSize: 20,
              leaseMs: 30_000
            }
          })
        ]
      }).compile()
    ).createNestApplication();

    await failingApp.init();

    try {
      const createResponse = await request(failingApp.getHttpServer())
        .post('/v1/parsing/jobs')
        .set('x-role', Role.OWNER)
        .set('x-trace-id', 'trace-e2e-queue-failed')
        .attach('file', createPdfBuffer(1, 'publisher failure'), {
          filename: 'queue-failed.pdf',
          contentType: 'application/pdf'
        });

      expect(createResponse.status).toBe(202);
      expect(createResponse.body.status).toBe('PUBLISH_PENDING');

      const statusResponse = await waitForJobStatus(createResponse.body.jobId, 'FAILED', failingApp);

      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body.status).toBe('FAILED');
      await expect(failingAppJobs.findById(createResponse.body.jobId)).resolves.toMatchObject({
        status: JobStatus.FAILED,
        errorCode: 'TRANSIENT_FAILURE',
        errorMessage: 'publisher offline'
      });

      const resultResponse = await request(failingApp.getHttpServer())
        .get(`/v1/parsing/jobs/${createResponse.body.jobId}/result`)
        .set('x-role', Role.OPERATOR);

      expect(resultResponse.status).toBe(404);

      const contextResponse = await request(failingApp.getHttpServer())
        .get(`/v1/ops/jobs/${createResponse.body.jobId}/context`)
        .set('x-role', Role.OPERATOR);

      expect(contextResponse.status).toBe(200);
      expect(contextResponse.body.summary.status).toBe('FAILED');
      expect(contextResponse.body.queuePublication).toMatchObject({
        status: 'FAILED',
        lastError: 'publisher offline'
      });
    } finally {
      await failingApp.close();
    }
  });

  it('rejects invalid x-role on submit without creating a job', async () => {
    const initialJobCount = (await jobs.list()).length;

    const response = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .set('x-role', 'INVALID_ROLE')
      .attach('file', createPdfBuffer(1, 'invalid role submit'), {
        filename: 'invalid-role.pdf',
        contentType: 'application/pdf'
      });

    expect(response.status).toBe(400);
    expect(response.headers['x-trace-id']).toBeDefined();
    expect(response.body).toEqual({
      errorCode: 'VALIDATION_ERROR',
      message: 'Invalid x-role header',
      metadata: {
        header: 'x-role',
        acceptedValues: [Role.OWNER, Role.OPERATOR],
        receivedValue: 'INVALID_ROLE'
      }
    });
    await expect(jobs.list()).resolves.toHaveLength(initialJobCount);
  });

  it('defaults missing actor headers to local-owner and OWNER', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .attach('file', createPdfBuffer(1, 'default actor headers'), {
        filename: 'default-owner.pdf',
        contentType: 'application/pdf'
      });

    expect(createResponse.status).toBe(202);
    expect(createResponse.body.status).toBe('PUBLISH_PENDING');

    await waitForJobStatus(createResponse.body.jobId, 'COMPLETED');

    const resultResponse = await request(app.getHttpServer()).get(
      `/v1/parsing/jobs/${createResponse.body.jobId}/result`
    );

    expect(resultResponse.status).toBe(200);

    const events = await audit.list();
    const queriedEvent = [...events].reverse().find(
      (event) =>
        event.eventType === 'RESULT_QUERIED' &&
        event.metadata?.jobId === createResponse.body.jobId &&
        event.actor.actorId === 'local-owner'
    );

    expect(queriedEvent).toMatchObject({
      eventType: 'RESULT_QUERIED',
      actor: {
        actorId: 'local-owner',
        role: Role.OWNER
      },
      metadata: {
        jobId: createResponse.body.jobId,
        documentId: createResponse.body.documentId
      }
    });
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
    expect(forbiddenResponse.body).toMatchObject({
      errorCode: 'AUTHORIZATION_ERROR',
      message: 'Only OWNER can request reprocessing'
    });
  });

  it('reprocesses a completed job without overwriting the original history', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .set('x-role', Role.OWNER)
      .attach('file', createPdfBuffer(1, 'reprocess success'), {
        filename: 'reprocess-success.pdf',
        contentType: 'application/pdf'
      });

    await waitForJobStatus(createResponse.body.jobId, 'COMPLETED');

    const originalResultResponse = await request(app.getHttpServer())
      .get(`/v1/parsing/jobs/${createResponse.body.jobId}/result`)
      .set('x-role', Role.OWNER);

    const reprocessResponse = await request(app.getHttpServer())
      .post(`/v1/parsing/jobs/${createResponse.body.jobId}/reprocess`)
      .set('x-role', Role.OWNER)
      .send({ reason: 'model update' });

    expect(reprocessResponse.status).toBe(202);
    expect(reprocessResponse.body.jobId).not.toBe(createResponse.body.jobId);
    expect(reprocessResponse.body.status).toBe('PUBLISH_PENDING');

    await waitForJobStatus(reprocessResponse.body.jobId, 'COMPLETED');

    const originalStatusResponse = await request(app.getHttpServer())
      .get(`/v1/parsing/jobs/${createResponse.body.jobId}`)
      .set('x-role', Role.OWNER);
    const latestOriginalResultResponse = await request(app.getHttpServer())
      .get(`/v1/parsing/jobs/${createResponse.body.jobId}/result`)
      .set('x-role', Role.OWNER);
    const reprocessedResultResponse = await request(app.getHttpServer())
      .get(`/v1/parsing/jobs/${reprocessResponse.body.jobId}/result`)
      .set('x-role', Role.OWNER);

    expect(originalStatusResponse.body.status).toBe('COMPLETED');
    expect(latestOriginalResultResponse.body.payload).toBe(originalResultResponse.body.payload);
    expect(reprocessedResultResponse.body.payload).toBe(originalResultResponse.body.payload);

    await expect(jobs.findById(reprocessResponse.body.jobId)).resolves.toMatchObject({
      reprocessOfJobId: createResponse.body.jobId,
      status: JobStatus.COMPLETED
    });

    const reprocessAttempts = await attempts.listByJobId(reprocessResponse.body.jobId);
    expect(reprocessAttempts).toHaveLength(1);
    expect(reprocessAttempts[0]).toMatchObject({
      attemptNumber: 1
    });
  });

  it('replays a dead letter into a new publish-pending job and marks the record as replayed after dispatch', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .set('x-role', Role.OWNER)
      .attach('file', createPdfBuffer(1, 'replay me'), {
        filename: 'replay.pdf',
        contentType: 'application/pdf'
      });

    await waitForJobStatus(createResponse.body.jobId, 'COMPLETED');
    const [attempt] = await attempts.listByJobId(createResponse.body.jobId);
    await deadLetters.save({
      dlqEventId: 'dlq-replay-1',
      jobId: createResponse.body.jobId,
      attemptId: attempt.attemptId,
      traceId: 'trace-dlq-source',
      queueName: 'document-processing.requested',
      reasonCode: 'DLQ_ERROR',
      reasonMessage: 'retries exhausted',
      retryCount: 3,
      payloadSnapshot: {
        jobId: createResponse.body.jobId,
        attemptId: attempt.attemptId
      },
      firstSeenAt: new Date('2026-03-25T12:00:00.000Z'),
      lastSeenAt: new Date('2026-03-25T12:00:00.000Z'),
      retentionUntil: new Date('2026-09-21T12:00:00.000Z')
    });

    const replayResponse = await request(app.getHttpServer())
      .post('/v1/parsing/dead-letters/dlq-replay-1/replay')
      .set('x-role', Role.OWNER)
      .set('x-trace-id', 'trace-e2e-replay')
      .send({ reason: 'manual replay' });

    expect(replayResponse.status).toBe(202);
    expect(replayResponse.headers['x-trace-id']).toBe('trace-e2e-replay');
    expect(replayResponse.body.jobId).not.toBe(createResponse.body.jobId);
    expect(replayResponse.body.status).toBe('PUBLISH_PENDING');

    await waitForJobStatus(replayResponse.body.jobId, 'COMPLETED');
    expect(lastPublishedTraceId).toBe('trace-e2e-replay');
    await expect(deadLetters.findById('dlq-replay-1')).resolves.toMatchObject({
      replayedAt: expect.any(Date)
    });
  });

  it('rejects invalid x-role when replaying a dead letter without mutating state', async () => {
    await deadLetters.save({
      dlqEventId: 'dlq-replay-invalid-role',
      jobId: 'job-invalid-role',
      attemptId: 'attempt-invalid-role',
      traceId: 'trace-dlq-invalid-role',
      queueName: 'document-processing.requested',
      reasonCode: 'DLQ_ERROR',
      reasonMessage: 'retries exhausted',
      retryCount: 3,
      payloadSnapshot: {
        jobId: 'job-invalid-role',
        attemptId: 'attempt-invalid-role'
      },
      firstSeenAt: new Date('2026-03-25T12:00:00.000Z'),
      lastSeenAt: new Date('2026-03-25T12:00:00.000Z'),
      retentionUntil: new Date('2026-09-21T12:00:00.000Z')
    });
    const initialJobCount = (await jobs.list()).length;

    const response = await request(app.getHttpServer())
      .post('/v1/parsing/dead-letters/dlq-replay-invalid-role/replay')
      .set('x-role', 'owner')
      .send({ reason: 'manual replay' });

    expect(response.status).toBe(400);
    expect(response.headers['x-trace-id']).toBeDefined();
    expect(response.body).toEqual({
      errorCode: 'VALIDATION_ERROR',
      message: 'Invalid x-role header',
      metadata: {
        header: 'x-role',
        acceptedValues: [Role.OWNER, Role.OPERATOR],
        receivedValue: 'owner'
      }
    });
    await expect(jobs.list()).resolves.toHaveLength(initialJobCount);
    const deadLetter = await deadLetters.findById('dlq-replay-invalid-role');
    expect(deadLetter?.replayedAt).toBeUndefined();
  });

  it('exposes the operational context JSON and redacted HTML panel for a completed job', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .set('x-role', Role.OWNER)
      .set('x-trace-id', 'trace-e2e-ops')
      .attach('file', createPdfBuffer(1, 'conteudo operacional'), {
        filename: 'ops.pdf',
        contentType: 'application/pdf'
      });

    await waitForJobStatus(createResponse.body.jobId, 'COMPLETED');

    const contextResponse = await request(app.getHttpServer())
      .get(`/v1/ops/jobs/${createResponse.body.jobId}/context`)
      .set('x-role', Role.OPERATOR);

    expect(contextResponse.status).toBe(200);
    expect(contextResponse.body.summary).toMatchObject({
      jobId: createResponse.body.jobId,
      documentId: createResponse.body.documentId,
      status: 'COMPLETED'
    });
    expect(contextResponse.body.queuePublication).toMatchObject({
      ownerService: 'orchestrator-api',
      flowType: 'submission'
    });
    expect(contextResponse.body.traceIds).toEqual(expect.arrayContaining(['trace-e2e-ops']));
    expect(contextResponse.body.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactType: 'OCR_JSON',
          previewText: 'cpf [cpf] email [email]'
        }),
        expect.objectContaining({
          artifactType: 'LLM_PROMPT',
          previewText: 'cpf [cpf] [token]'
        }),
        expect.objectContaining({
          artifactType: 'LLM_RESPONSE',
          previewText: 'email [email] [token]'
        })
      ])
    );
    expect(contextResponse.body.telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceName: 'document-parser-worker',
          kind: 'span'
        })
      ])
    );

    const panelResponse = await request(app.getHttpServer())
      .get(`/ops/jobs/${createResponse.body.jobId}`)
      .set('x-role', Role.OPERATOR);

    expect(panelResponse.status).toBe(200);
    expect(panelResponse.headers['content-type']).toContain('text/html');
    expect(panelResponse.text).toContain('Operational Context');
    expect(panelResponse.text).toContain(createResponse.body.jobId);
    expect(panelResponse.text).toContain('document-parser-worker');
    expect(panelResponse.text).toContain('Queue Publication');
    expect(panelResponse.text).toContain('cpf [cpf] email [email]');
    expect(panelResponse.text).toContain('cpf [cpf] [token]');
    expect(panelResponse.text).toContain('email [email] [token]');
    expect(panelResponse.text).not.toContain('123.456.789-00');
    expect(panelResponse.text).not.toContain('paciente@example.com');
    expect(panelResponse.text).not.toContain('sk_live_super_secret_token_1234567890');
  });

  it('rejects invalid x-role on operational context reads', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/ops/jobs/job-invalid-role/context')
      .set('x-role', 'operator');

    expect(response.status).toBe(400);
    expect(response.headers['x-trace-id']).toBeDefined();
    expect(response.body).toEqual({
      errorCode: 'VALIDATION_ERROR',
      message: 'Invalid x-role header',
      metadata: {
        header: 'x-role',
        acceptedValues: [Role.OWNER, Role.OPERATOR],
        receivedValue: 'operator'
      }
    });
  });
});
