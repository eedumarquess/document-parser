import {
  AttemptStatus,
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  ErrorCode,
  ExtractionWarning,
  FallbackReason,
  InMemoryLoggingAdapter,
  InMemoryMetricsAdapter,
  InMemoryTracingAdapter,
  JobStatus,
  RedactionPolicyService,
  RetentionPolicyService,
  Role
} from '@document-parser/shared-kernel';
import { FixedClock, IncrementalIdGenerator, InMemoryPublishedMessageBus, buildActor } from '@document-parser/testkit';
import { createDefaultExtractionPipeline } from '../../src/adapters/out/extraction/default-extraction.factory';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryUnitOfWork
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { ProcessJobMessageUseCase } from '../../src/application/use-cases/process-job-message.use-case';
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

type WorkerContextOptions = {
  attemptNumber?: number;
  persistDocument?: boolean;
  persistJob?: boolean;
  persistAttempt?: boolean;
};

const createWorkerContext = async (buffer: Buffer, optionsOrAttemptNumber: WorkerContextOptions | number = 1) => {
  const options = typeof optionsOrAttemptNumber === 'number' ? { attemptNumber: optionsOrAttemptNumber } : optionsOrAttemptNumber;
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
  const logging = new InMemoryLoggingAdapter();
  const metrics = new InMemoryMetricsAdapter();
  const tracing = new InMemoryTracingAdapter();
  const extraction = createDefaultExtractionPipeline(new ProcessingOutcomePolicy());
  const retentionPolicy = new RetentionPolicyService();
  const redactionPolicy = new RedactionPolicyService();
  const pageCount = Math.max(1, buffer.toString('utf8').split('[[PAGE_BREAK]]').length);

  const storageReference = await storage.storeOriginal({
    documentId,
    originalName: 'sample.pdf',
    buffer
  });

  if (options.persistDocument ?? true) {
    await documents.save({
      documentId,
      hash: 'sha256:doc',
      originalFileName: 'sample.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: buffer.byteLength,
      pageCount,
      sourceType: 'MULTIPART',
      storageReference,
      retentionUntil: new Date('2026-04-25T12:00:00.000Z'),
      createdAt: clock.now(),
      updatedAt: clock.now()
    });
  }
  if (options.persistJob ?? true) {
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
  }
  if (options.persistAttempt ?? true) {
    await attempts.save({
      attemptId,
      jobId,
      attemptNumber: options.attemptNumber ?? 1,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      status: AttemptStatus.QUEUED,
      fallbackUsed: false,
      createdAt: clock.now()
    });
  }

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
    logging,
    metrics,
    tracing,
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
      logging,
      metrics,
      tracing,
      publisher,
      new InMemoryUnitOfWork(),
      extraction,
      new RetryPolicyService(),
      retentionPolicy,
      redactionPolicy
    )
  };
};

const executeMessage = async (context: Awaited<ReturnType<typeof createWorkerContext>>) =>
  context.useCase.execute({
    message: {
      documentId: context.documentId,
      jobId: context.jobId,
      attemptId: context.attemptId,
      traceId: 'trace-worker-1',
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      publishedAt: context.clock.now().toISOString()
    }
  });

describe('ProcessJobMessageUseCase', () => {
  it('processes a clean OCR document without fallback', async () => {
    const context = await createWorkerContext(Buffer.from('%PDF-1.4\n/Type /Page\nconteudo extraido'));

    await executeMessage(context);

    expect(await context.results.findByJobId(context.jobId)).toMatchObject({
      status: JobStatus.COMPLETED,
      engineUsed: 'OCR',
      payload: 'conteudo extraido'
    });
    expect(await context.jobs.findById(context.jobId)).toMatchObject({
      status: JobStatus.COMPLETED
    });
    expect(await context.artifacts.listByJobId(context.jobId)).toHaveLength(2);
  });

  it('executes target-level fallback and persists masked text, prompt and response', async () => {
    const context = await createWorkerContext(
      Buffer.from('%PDF-1.4\n/Type /Page\nPaciente consciente. [[AMBIGUOUS_CHECKBOX:febre:checked]]')
    );

    await executeMessage(context);

    expect(await context.results.findByJobId(context.jobId)).toMatchObject({
      status: JobStatus.COMPLETED,
      engineUsed: 'OCR+LLM',
      payload: 'Paciente consciente. febre: [marcado]'
    });
    expect(await context.attempts.findById(context.attemptId)).toMatchObject({
      status: AttemptStatus.COMPLETED,
      fallbackUsed: true,
      fallbackReason: FallbackReason.CHECKBOX_AMBIGUOUS
    });
    expect(await context.artifacts.listByJobId(context.jobId)).toHaveLength(5);
  });

  it('restores masked placeholders before consolidating the final payload', async () => {
    const context = await createWorkerContext(
      Buffer.from('%PDF-1.4\n/Type /Page\n[[CRITICAL_MISSING:cpf:123.456.789-00]]')
    );

    await executeMessage(context);

    expect(await context.results.findByJobId(context.jobId)).toMatchObject({
      status: JobStatus.COMPLETED,
      payload: 'cpf: 123.456.789-00'
    });
    expect((await context.artifacts.listByJobId(context.jobId)).find((artifact) => artifact.artifactType === 'MASKED_TEXT'))
      .toMatchObject({
        metadata: {
          maskedText: 'cpf:[cpf_1]',
          fallbackReason: FallbackReason.CRITICAL_TARGET_MISSING
        }
      });
  });

  it('keeps a usable payload when a fallback target becomes unavailable', async () => {
    const context = await createWorkerContext(
      Buffer.from('Primeira pagina valida[[PAGE_BREAK]][[OCR_EMPTY]] [[LLM_UNAVAILABLE]]')
    );

    await executeMessage(context);

    expect(await context.results.findByJobId(context.jobId)).toMatchObject({
      status: JobStatus.PARTIAL,
      warnings: expect.arrayContaining([
        ExtractionWarning.ILLEGIBLE_CONTENT,
        ExtractionWarning.LLM_FALLBACK_UNAVAILABLE
      ])
    });
    expect(await context.jobs.findById(context.jobId)).toMatchObject({
      status: JobStatus.PARTIAL
    });
    expect(await context.artifacts.listByJobId(context.jobId)).toHaveLength(7);
  });

  it('fails when no usable payload remains after OCR and fallback attempts', async () => {
    const context = await createWorkerContext(Buffer.from('[[OCR_EMPTY]] [[LLM_UNAVAILABLE]]'));

    await expect(executeMessage(context)).rejects.toThrow('No usable payload after OCR and allowed fallbacks');

    expect(await context.results.findByJobId(context.jobId)).toBeUndefined();
    expect(await context.jobs.findById(context.jobId)).toMatchObject({
      status: JobStatus.FAILED
    });
    expect(await context.deadLetters.list()).toHaveLength(1);
  });

  it('retries transient failures and republishes a new attempt', async () => {
    const context = await createWorkerContext(Buffer.from('[[TRANSIENT_FAILURE]]'));

    await executeMessage(context);

    expect(await context.jobs.findById(context.jobId)).toMatchObject({
      status: JobStatus.QUEUED
    });
    expect(context.publisher.messages).toHaveLength(1);
    expect(context.publisher.messages[0]).toMatchObject({
      traceId: 'trace-worker-1'
    });
    expect(await context.attempts.findById(context.attemptId)).toMatchObject({
      status: AttemptStatus.FAILED,
      errorCode: ErrorCode.TRANSIENT_FAILURE
    });
  });

  it('sends terminal failures to DLQ when retries are exhausted', async () => {
    const context = await createWorkerContext(Buffer.from('[[TRANSIENT_FAILURE]]'), { attemptNumber: 3 });

    await expect(executeMessage(context)).rejects.toThrow('Deterministic extraction pipeline transient failure');

    expect(await context.jobs.findById(context.jobId)).toMatchObject({
      status: JobStatus.FAILED
    });
    await expect(context.deadLetters.list()).resolves.toEqual([
      expect.objectContaining({
        traceId: 'trace-worker-1'
      })
    ]);
    expect(context.publisher.messages).toHaveLength(0);
  });

  it('moves the attempt to application DLQ when the document context is missing', async () => {
    const context = await createWorkerContext(Buffer.from('contexto faltante'), { persistDocument: false });

    await expect(executeMessage(context)).rejects.toThrow('Worker context is incomplete');

    await expect(context.jobs.findById(context.jobId)).resolves.toMatchObject({
      status: JobStatus.FAILED,
      errorCode: ErrorCode.FATAL_FAILURE
    });
    await expect(context.attempts.findById(context.attemptId)).resolves.toMatchObject({
      status: AttemptStatus.MOVED_TO_DLQ,
      errorCode: ErrorCode.FATAL_FAILURE
    });
    await expect(context.deadLetters.list()).resolves.toEqual([
      expect.objectContaining({
        jobId: context.jobId,
        attemptId: context.attemptId,
        reasonCode: ErrorCode.FATAL_FAILURE,
        payloadSnapshot: expect.objectContaining({
          missingResources: ['document']
        })
      })
    ]);
    await expect(context.audit.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PROCESSING_FAILED',
          metadata: expect.objectContaining({
            missingResources: ['document']
          })
        })
      ])
    );
    expect(await context.results.findByJobId(context.jobId)).toBeUndefined();
  });

  it('records application DLQ and audit when the attempt context is missing', async () => {
    const context = await createWorkerContext(Buffer.from('contexto faltante'), { persistAttempt: false });

    await expect(executeMessage(context)).rejects.toThrow('Worker context is incomplete');

    await expect(context.jobs.findById(context.jobId)).resolves.toMatchObject({
      status: JobStatus.QUEUED
    });
    await expect(context.deadLetters.list()).resolves.toEqual([
      expect.objectContaining({
        jobId: context.jobId,
        attemptId: context.attemptId,
        reasonCode: ErrorCode.FATAL_FAILURE,
        retryCount: 0,
        payloadSnapshot: expect.objectContaining({
          missingResources: ['attempt']
        })
      })
    ]);
    await expect(context.audit.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PROCESSING_FAILED',
          metadata: expect.objectContaining({
            missingResources: ['attempt']
          })
        })
      ])
    );
    expect(await context.results.findByJobId(context.jobId)).toBeUndefined();
  });

  it('records application DLQ and audit when the job context is missing', async () => {
    const context = await createWorkerContext(Buffer.from('contexto faltante'), { persistJob: false });

    await expect(executeMessage(context)).rejects.toThrow('Worker context is incomplete');

    await expect(context.jobs.findById(context.jobId)).resolves.toBeUndefined();
    await expect(context.deadLetters.list()).resolves.toEqual([
      expect.objectContaining({
        jobId: context.jobId,
        attemptId: context.attemptId,
        queueName: 'document-processing.requested',
        reasonCode: ErrorCode.FATAL_FAILURE,
        retryCount: 1,
        payloadSnapshot: expect.objectContaining({
          missingResources: ['job']
        })
      })
    ]);
    await expect(context.audit.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PROCESSING_FAILED',
          metadata: expect.objectContaining({
            missingResources: ['job']
          })
        })
      ])
    );
    expect(await context.results.findByJobId(context.jobId)).toBeUndefined();
  });

  it('keeps a single logical persisted result in the worker in-memory repository per jobId', async () => {
    const context = await createWorkerContext(Buffer.from('repositorio'));

    await context.results.save({
      resultId: 'result-1',
      jobId: context.jobId,
      documentId: context.documentId,
      compatibilityKey: 'compatibility-1',
      status: JobStatus.COMPLETED,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.8,
      warnings: [],
      payload: 'payload antigo',
      engineUsed: 'OCR',
      totalLatencyMs: 100,
      createdAt: context.clock.now(),
      updatedAt: context.clock.now(),
      retentionUntil: new Date('2026-06-23T12:00:00.000Z')
    });
    await context.results.save({
      resultId: 'result-2',
      jobId: context.jobId,
      documentId: context.documentId,
      compatibilityKey: 'compatibility-1',
      status: JobStatus.PARTIAL,
      requestedMode: 'STANDARD',
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      confidence: 0.9,
      warnings: ['ILLEGIBLE_CONTENT'],
      payload: 'payload novo',
      engineUsed: 'OCR+LLM',
      totalLatencyMs: 120,
      createdAt: context.clock.now(),
      updatedAt: context.clock.now(),
      retentionUntil: new Date('2026-06-23T12:01:00.000Z')
    });

    await expect(context.results.findByJobId(context.jobId)).resolves.toMatchObject({
      resultId: 'result-2',
      payload: 'payload novo',
      status: JobStatus.PARTIAL
    });
  });
});
