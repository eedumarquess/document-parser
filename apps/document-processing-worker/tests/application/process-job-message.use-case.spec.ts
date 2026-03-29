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
import { FixedClock, IncrementalIdGenerator, buildActor } from '@document-parser/testkit';
import { createDefaultExtractionPipeline } from '../../src/adapters/out/extraction/default-extraction.factory';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryQueuePublicationOutboxRepository,
  InMemoryUnitOfWork
} from '../../src/adapters/out/repositories/in-memory.repositories';
import type {
  DocumentRecord,
  JobAttemptRecord,
  ProcessingJobRecord
} from '../../src/contracts/models';
import type {
  DocumentRepositoryPort,
  JobAttemptRepositoryPort,
  ProcessingJobRepositoryPort
} from '../../src/contracts/ports';
import { AuditEventRecorder } from '../../src/application/services/audit-event-recorder.service';
import { AttemptExecutionCoordinator } from '../../src/application/services/attempt-execution-coordinator.service';
import {
  InconsistentProcessingContextError,
  ProcessingContextLoader
} from '../../src/application/services/processing-context-loader.service';
import { ProcessingFailureRecoveryService } from '../../src/application/services/processing-failure-recovery.service';
import { ProcessingSuccessPersister } from '../../src/application/services/processing-success-persister.service';
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
  const outbox = new InMemoryQueuePublicationOutboxRepository();
  const logging = new InMemoryLoggingAdapter();
  const metrics = new InMemoryMetricsAdapter();
  const tracing = new InMemoryTracingAdapter();
  const extraction = createDefaultExtractionPipeline(new ProcessingOutcomePolicy());
  const unitOfWork = new InMemoryUnitOfWork();
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
    outbox,
    logging,
    metrics,
    tracing,
    extraction,
    unitOfWork,
    useCase: new ProcessJobMessageUseCase(
      clock,
      logging,
      metrics,
      tracing,
      redactionPolicy,
      new ProcessingContextLoader(jobs, documents, attempts),
      new AttemptExecutionCoordinator(storage, jobs, attempts, unitOfWork, extraction),
      new ProcessingSuccessPersister(
        idGenerator,
        jobs,
        attempts,
        results,
        artifacts,
        unitOfWork,
        retentionPolicy,
        new AuditEventRecorder(audit, idGenerator, retentionPolicy, redactionPolicy)
      ),
      new ProcessingFailureRecoveryService(
        idGenerator,
        jobs,
        attempts,
        deadLetters,
        outbox,
        unitOfWork,
        new RetryPolicyService(),
        retentionPolicy,
        redactionPolicy,
        new AuditEventRecorder(audit, idGenerator, retentionPolicy, redactionPolicy)
      )
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
      status: JobStatus.PUBLISH_PENDING
    });
    await expect(context.outbox.list()).resolves.toEqual([
      expect.objectContaining({
        jobId: context.jobId,
        documentId: context.documentId,
        flowType: 'retry',
        dispatchKind: 'publish_retry',
        retryAttempt: 1,
        status: 'PENDING',
        messageBase: expect.objectContaining({
          traceId: 'trace-worker-1'
        })
      })
    ]);
    expect(await context.attempts.findById(context.attemptId)).toMatchObject({
      status: AttemptStatus.FAILED,
      errorCode: ErrorCode.TRANSIENT_FAILURE
    });
    await expect(context.attempts.listByJobId(context.jobId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptNumber: 2,
          status: AttemptStatus.PENDING
        })
      ])
    );
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
    await expect(context.outbox.list()).resolves.toEqual([]);
  });

  it('ignores duplicate messages when the job and attempt already advanced', async () => {
    const context = await createWorkerContext(Buffer.from('conteudo duplicado'));

    await context.jobs.save({
      ...(await context.jobs.findById(context.jobId))!,
      status: JobStatus.PROCESSING
    });
    await context.attempts.save({
      ...(await context.attempts.findById(context.attemptId))!,
      status: AttemptStatus.PROCESSING
    });

    await expect(executeMessage(context)).resolves.toBeUndefined();

    await expect(context.results.findByJobId(context.jobId)).resolves.toBeUndefined();
    await expect(context.deadLetters.list()).resolves.toEqual([]);
    await expect(context.outbox.list()).resolves.toEqual([]);
    expect(context.metrics.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'counter',
          name: 'worker.queue_publication_outbox.duplicate_skipped',
          traceId: 'trace-worker-1'
        })
      ])
    );
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

  it('quarantines processing when the loaded attempt belongs to another job', async () => {
    const context = await createWorkerContext(Buffer.from('contexto cruzado'));

    await context.attempts.save({
      ...(await context.attempts.findById(context.attemptId))!,
      jobId: 'job-foreign'
    });

    await expect(executeMessage(context)).rejects.toThrow('Worker context is inconsistent');

    await expect(context.jobs.findById(context.jobId)).resolves.toMatchObject({
      status: JobStatus.QUEUED
    });
    await expect(context.attempts.findById(context.attemptId)).resolves.toMatchObject({
      status: AttemptStatus.QUEUED,
      jobId: 'job-foreign'
    });
    await expect(context.results.findByJobId(context.jobId)).resolves.toBeUndefined();
    await expect(context.artifacts.listByJobId(context.jobId)).resolves.toHaveLength(0);
    await expect(context.deadLetters.list()).resolves.toEqual([
      expect.objectContaining({
        jobId: context.jobId,
        attemptId: context.attemptId,
        reasonCode: ErrorCode.FATAL_FAILURE,
        payloadSnapshot: expect.objectContaining({
          contextIssue: 'relationship_mismatch',
          mismatches: expect.arrayContaining([
            expect.objectContaining({
              rule: 'attempt.jobId === job.jobId',
              expected: context.jobId,
              actual: 'job-foreign'
            })
          ])
        })
      })
    ]);
    await expect(context.audit.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PROCESSING_FAILED',
          metadata: expect.objectContaining({
            contextIssue: 'relationship_mismatch',
            mismatches: expect.arrayContaining([
              expect.objectContaining({
                rule: 'attempt.jobId === job.jobId',
                expected: context.jobId,
                actual: 'job-foreign'
              })
            ])
          })
        })
      ])
    );
  });

  it('quarantines processing when the loaded job points to another document', async () => {
    const context = await createWorkerContext(Buffer.from('contexto cruzado'));

    await context.jobs.save({
      ...(await context.jobs.findById(context.jobId))!,
      documentId: 'doc-foreign'
    });

    await expect(executeMessage(context)).rejects.toThrow('Worker context is inconsistent');

    await expect(context.jobs.findById(context.jobId)).resolves.toMatchObject({
      status: JobStatus.QUEUED,
      documentId: 'doc-foreign'
    });
    await expect(context.attempts.findById(context.attemptId)).resolves.toMatchObject({
      status: AttemptStatus.QUEUED
    });
    await expect(context.results.findByJobId(context.jobId)).resolves.toBeUndefined();
    await expect(context.artifacts.listByJobId(context.jobId)).resolves.toHaveLength(0);
    await expect(context.deadLetters.list()).resolves.toEqual([
      expect.objectContaining({
        jobId: context.jobId,
        attemptId: context.attemptId,
        reasonCode: ErrorCode.FATAL_FAILURE,
        payloadSnapshot: expect.objectContaining({
          contextIssue: 'relationship_mismatch',
          mismatches: expect.arrayContaining([
            expect.objectContaining({
              rule: 'job.documentId === document.documentId',
              expected: context.documentId,
              actual: 'doc-foreign'
            })
          ])
        })
      })
    ]);
    await expect(context.audit.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PROCESSING_FAILED',
          metadata: expect.objectContaining({
            contextIssue: 'relationship_mismatch',
            mismatches: expect.arrayContaining([
              expect.objectContaining({
                rule: 'job.documentId === document.documentId',
                expected: context.documentId,
                actual: 'doc-foreign'
              })
            ])
          })
        })
      ])
    );
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

describe('ProcessingContextLoader', () => {
  const now = new Date('2026-03-27T12:00:00.000Z');
  const baseDocument: DocumentRecord = {
    documentId: 'doc-1',
    hash: 'sha256:doc',
    originalFileName: 'sample.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 10,
    pageCount: 1,
    sourceType: 'MULTIPART',
    storageReference: {
      bucket: 'documents',
      objectKey: 'original/doc-1/sample.pdf'
    },
    retentionUntil: new Date('2026-04-25T12:00:00.000Z'),
    createdAt: now,
    updatedAt: now
  };
  const baseJob: ProcessingJobRecord = {
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
    acceptedAt: now,
    queuedAt: now,
    requestedBy: buildActor({ role: Role.OWNER }),
    warnings: [],
    ingestionTransitions: [{ status: JobStatus.QUEUED, at: now }],
    createdAt: now,
    updatedAt: now
  };
  const baseAttempt: JobAttemptRecord = {
    attemptId: 'attempt-1',
    jobId: 'job-1',
    attemptNumber: 1,
    pipelineVersion: DEFAULT_PIPELINE_VERSION,
    status: AttemptStatus.QUEUED,
    fallbackUsed: false,
    createdAt: now
  };

  it('rejects corrupted repositories when the returned job does not match the message jobId', async () => {
    const loader = new ProcessingContextLoader(
      {
        findById: async () => ({
          ...baseJob,
          jobId: 'job-record'
        }),
        updateIfCurrentStatus: async () => true,
        save: async () => undefined
      } as ProcessingJobRepositoryPort,
      {
        findById: async () => ({
          ...baseDocument
        })
      } as DocumentRepositoryPort,
      {
        findById: async () => ({
          ...baseAttempt,
          jobId: 'job-record'
        }),
        save: async () => undefined,
        updateIfCurrentStatus: async () => true,
        listByJobId: async () => []
      } as JobAttemptRepositoryPort
    );

    try {
      await loader.load({
        documentId: 'doc-1',
        jobId: 'job-message',
        attemptId: 'attempt-1',
        traceId: 'trace-loader-1',
        requestedMode: 'STANDARD',
        pipelineVersion: DEFAULT_PIPELINE_VERSION,
        publishedAt: now.toISOString()
      });
      throw new Error('Expected loader to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(InconsistentProcessingContextError);
      if (!(error instanceof InconsistentProcessingContextError)) {
        throw error;
      }
      expect(error.contextIssue).toBe('relationship_mismatch');
      expect(error.mismatches).toEqual([
        {
          rule: 'message.jobId === job.jobId',
          expected: 'job-message',
          actual: 'job-record'
        }
      ]);
    }
  });

  it('rejects corrupted repositories when the returned document does not match the message documentId', async () => {
    const loader = new ProcessingContextLoader(
      {
        findById: async () => ({
          ...baseJob,
          documentId: 'doc-record'
        }),
        updateIfCurrentStatus: async () => true,
        save: async () => undefined
      } as ProcessingJobRepositoryPort,
      {
        findById: async () => ({
          ...baseDocument,
          documentId: 'doc-record'
        })
      } as DocumentRepositoryPort,
      {
        findById: async () => ({
          ...baseAttempt
        }),
        save: async () => undefined,
        updateIfCurrentStatus: async () => true,
        listByJobId: async () => []
      } as JobAttemptRepositoryPort
    );

    try {
      await loader.load({
        documentId: 'doc-message',
        jobId: 'job-1',
        attemptId: 'attempt-1',
        traceId: 'trace-loader-2',
        requestedMode: 'STANDARD',
        pipelineVersion: DEFAULT_PIPELINE_VERSION,
        publishedAt: now.toISOString()
      });
      throw new Error('Expected loader to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(InconsistentProcessingContextError);
      if (!(error instanceof InconsistentProcessingContextError)) {
        throw error;
      }
      expect(error.contextIssue).toBe('relationship_mismatch');
      expect(error.mismatches).toEqual([
        {
          rule: 'message.documentId === document.documentId',
          expected: 'doc-message',
          actual: 'doc-record'
        }
      ]);
    }
  });

  it('rejects corrupted repositories when the returned attempt does not match the message attemptId', async () => {
    const loader = new ProcessingContextLoader(
      {
        findById: async () => ({
          ...baseJob
        }),
        updateIfCurrentStatus: async () => true,
        save: async () => undefined
      } as ProcessingJobRepositoryPort,
      {
        findById: async () => ({
          ...baseDocument
        })
      } as DocumentRepositoryPort,
      {
        findById: async () => ({
          ...baseAttempt,
          attemptId: 'attempt-record'
        }),
        save: async () => undefined,
        updateIfCurrentStatus: async () => true,
        listByJobId: async () => []
      } as JobAttemptRepositoryPort
    );

    try {
      await loader.load({
        documentId: 'doc-1',
        jobId: 'job-1',
        attemptId: 'attempt-message',
        traceId: 'trace-loader-3',
        requestedMode: 'STANDARD',
        pipelineVersion: DEFAULT_PIPELINE_VERSION,
        publishedAt: now.toISOString()
      });
      throw new Error('Expected loader to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(InconsistentProcessingContextError);
      if (!(error instanceof InconsistentProcessingContextError)) {
        throw error;
      }
      expect(error.contextIssue).toBe('relationship_mismatch');
      expect(error.mismatches).toEqual([
        {
          rule: 'message.attemptId === attempt.attemptId',
          expected: 'attempt-message',
          actual: 'attempt-record'
        }
      ]);
    }
  });
});
