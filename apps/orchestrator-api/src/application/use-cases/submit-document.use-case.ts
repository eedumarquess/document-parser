import { Inject, Injectable } from '@nestjs/common';
import {
  CompatibilityKey,
  VersionStampService,
  createDeduplicatedJob,
  createPendingAttempt,
  createSubmissionJob,
  markJobAsPublishPending,
  markJobAsStored,
  markJobAsValidated,
  type JobAttemptRecord
} from '@document-parser/document-processing-domain';
import {
  DEFAULT_PROCESSING_QUEUE_NAME,
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  RedactionPolicyService,
  type AuditActor,
  ValidationError
} from '@document-parser/shared-kernel';
import type { JobResponse } from '../../contracts/http';
import type { DocumentRecord, ProcessingJobRecord, ProcessingResultRecord } from '../../contracts/models';
import type {
  AuthorizationPort,
  BinaryStoragePort,
  ClockPort,
  CompatibleResultLookupPort,
  DocumentRepositoryPort,
  HashingPort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  LoggingPort,
  MetricsPort,
  PageCounterPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  QueuePublicationOutboxRepositoryPort,
  TracingPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { CompatibleResultReusePolicy } from '../../domain/policies/compatible-result-reuse.policy';
import { DocumentAcceptancePolicy } from '../../domain/policies/document-acceptance.policy';
import { DocumentStoragePolicy } from '../../domain/policies/document-storage.policy';
import { PageCountPolicy } from '../../domain/policies/page-count.policy';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';
import { DocumentHash } from '../../domain/value-objects/document-hash';
import { toJobResponse } from '../mappers/job-response.mapper';
import { AuditEventRecorder } from '../services/audit-event-recorder.service';
import { buildOrchestratorQueuePublicationOutboxRecord } from '../services/queue-publication-outbox-dispatcher.service';
import type { SubmitDocumentCommand } from '../commands/submit-document.command';

@Injectable()
export class SubmitDocumentUseCase {
  private readonly versionStamps = new VersionStampService();

  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.HASHING) private readonly hashing: HashingPort,
    @Inject(TOKENS.PAGE_COUNTER) private readonly pageCounter: PageCounterPort,
    @Inject(TOKENS.BINARY_STORAGE) private readonly storage: BinaryStoragePort,
    @Inject(TOKENS.DOCUMENT_REPOSITORY) private readonly documents: DocumentRepositoryPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.RESULT_REPOSITORY) private readonly results: ProcessingResultRepositoryPort,
    @Inject(TOKENS.COMPATIBLE_RESULT_LOOKUP)
    private readonly compatibleResults: CompatibleResultLookupPort,
    @Inject(TOKENS.QUEUE_PUBLICATION_OUTBOX_REPOSITORY)
    private readonly outbox: QueuePublicationOutboxRepositoryPort,
    @Inject(TOKENS.LOGGING) private readonly logging: LoggingPort,
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.TRACING) private readonly tracing: TracingPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly acceptancePolicy: DocumentAcceptancePolicy,
    private readonly reusePolicy: CompatibleResultReusePolicy,
    private readonly pageCountPolicy: PageCountPolicy,
    private readonly documentStoragePolicy: DocumentStoragePolicy,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService,
    private readonly auditEventRecorder: AuditEventRecorder
  ) {}

  public async execute(command: SubmitDocumentCommand, actor: AuditActor, traceId: string): Promise<JobResponse> {
    const startedAt = Date.now();

    return this.tracing.runInSpan(
      {
        traceId,
        spanName: 'orchestrator.submit_document',
        attributes: {
          actorId: actor.actorId,
          requestedMode: command.requestedMode,
          forceReprocess: command.forceReprocess
        }
      },
      async () => {
        try {
          this.authorizeSubmission(actor);
          this.ensureUploadedFileIsNotEmpty(command);

          const pageCount = await this.countDocumentPages(command);
          this.validateUploadedFileConstraints(command, pageCount);

          const hash = await this.calculateDocumentHash(command);
          const now = this.clock.now();
          const requestedMode = command.requestedMode;
          const { pipelineVersion, outputVersion } = this.versionStamps.buildJobStamp({
            pipelineVersion: DEFAULT_PIPELINE_VERSION,
            outputVersion: DEFAULT_OUTPUT_VERSION
          });
          const existingDocument = await this.findExistingDocumentByHash(hash);
          const compatibilityKey = this.buildCompatibilityKey({
            hash,
            requestedMode,
            pipelineVersion,
            outputVersion
          });
          const compatibleResult = await this.findCompatibleResultForSubmission({
            hash,
            requestedMode,
            pipelineVersion,
            outputVersion,
            forceReprocess: command.forceReprocess
          });

          if (
            compatibleResult !== undefined &&
            this.reusePolicy.shouldReuse({ compatibleResult, forceReprocess: command.forceReprocess })
          ) {
            const response = await this.finalizeDeduplicatedJob({
              actor,
              compatibleResult,
              compatibilityKey,
              documentId: existingDocument?.documentId ?? compatibleResult.documentId,
              requestedMode,
              pipelineVersion,
              outputVersion,
              traceId,
              now
            });

            await this.logging.log({
              level: 'info',
            message: 'Document submission reused a compatible result',
            context: 'SubmitDocumentUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                jobId: response.jobId,
                documentId: response.documentId,
                operation: 'submit_document',
                reusedResult: response.reusedResult
              },
              {
                context: 'log'
              }
            ),
            recordedAt: now
          });
            await this.metrics.increment({
              name: 'orchestrator.submit_document.reused_result',
              traceId,
              tags: {
                jobId: response.jobId,
                documentId: response.documentId,
                operation: 'submit_document'
              }
            });

            return response;
          }

          const canonicalDocument = await this.storeOriginalDocumentBinaryWhenNeeded({
            command,
            existingDocument,
            hash,
            pageCount,
            now
          });
          const persistedSubmission = await this.persistAcceptedSubmission({
            actor,
            document: canonicalDocument.document,
            storedNewBinary: canonicalDocument.storedNewBinary,
            requestedMode,
            pipelineVersion,
            outputVersion,
            forceReprocess: command.forceReprocess,
            traceId,
            now
          });

          await this.logging.log({
            level: 'info',
            message: 'Document submission accepted for asynchronous queue publication',
            context: 'SubmitDocumentUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                jobId: persistedSubmission.job.jobId,
                documentId: persistedSubmission.job.documentId,
                operation: 'submit_document',
                requestedMode: persistedSubmission.job.requestedMode,
                status: persistedSubmission.job.status
              },
              {
                context: 'log'
              }
            ),
            recordedAt: now
          });
          await this.metrics.increment({
            name: 'orchestrator.queue_publication_outbox.enqueued',
            traceId,
            tags: {
              ownerService: 'orchestrator-api',
              flowType: 'submission',
              dispatchKind: 'publish_requested'
            }
          });
          await this.metrics.increment({
            name: 'orchestrator.submit_document.accepted',
            traceId,
            tags: {
              jobId: persistedSubmission.job.jobId,
              documentId: persistedSubmission.job.documentId,
              operation: 'submit_document'
            }
          });

          return toJobResponse(persistedSubmission.job);
        } catch (error) {
          await this.metrics.increment({
            name: 'orchestrator.submit_document.failed',
            traceId,
            tags: {
              operation: 'submit_document'
            }
          });
          await this.logging.log({
            level: 'error',
            message: 'Document submission failed',
            context: 'SubmitDocumentUseCase',
            traceId,
            data: this.redactionPolicy.redact(
              {
                actorId: actor.actorId,
                requestedMode: command.requestedMode,
                operation: 'submit_document',
                errorMessage: error instanceof Error ? error.message : 'Unexpected failure'
              },
              {
                context: 'log'
              }
            ),
            recordedAt: this.clock.now()
          });
          throw error;
        } finally {
          await this.metrics.recordHistogram({
            name: 'orchestrator.submit_document.duration_ms',
            value: Date.now() - startedAt,
            traceId,
            tags: {
              operation: 'submit_document'
            }
          });
        }
      }
    );
  }

  private authorizeSubmission(actor: AuditActor): void {
    this.authorization.ensureCanSubmit(actor);
  }

  private ensureUploadedFileIsNotEmpty(command: SubmitDocumentCommand): void {
    if (command.file.buffer.length === 0) {
      throw new ValidationError('Uploaded file cannot be empty');
    }
  }

  private async countDocumentPages(command: SubmitDocumentCommand): Promise<number> {
    return this.pageCountPolicy.countPages({
      file: command.file,
      pageCounter: this.pageCounter
    });
  }

  private validateUploadedFileConstraints(command: SubmitDocumentCommand, pageCount: number): void {
    this.acceptancePolicy.validate({
      mimeType: command.file.mimeType,
      fileSizeBytes: command.file.size,
      pageCount
    });
  }

  private async calculateDocumentHash(command: SubmitDocumentCommand): Promise<string> {
    return DocumentHash.create(await this.hashing.calculateHash(command.file.buffer)).value;
  }

  private async findExistingDocumentByHash(hash: string): Promise<DocumentRecord | undefined> {
    return this.documents.findByHash(hash);
  }

  private buildCompatibilityKey(input: {
    hash: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
  }): string {
    return CompatibilityKey.build(input);
  }

  private async findCompatibleResultForSubmission(input: {
    hash: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    forceReprocess: boolean;
  }): Promise<ProcessingResultRecord | undefined> {
    if (input.forceReprocess) {
      return undefined;
    }

    return this.compatibleResults.findByCompatibilityKey({
      hash: input.hash,
      requestedMode: input.requestedMode,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion
    });
  }

  private async storeOriginalDocumentBinaryWhenNeeded(input: {
    command: SubmitDocumentCommand;
    existingDocument?: DocumentRecord;
    hash: string;
    pageCount: number;
    now: Date;
  }): Promise<{ document: DocumentRecord; storedNewBinary: boolean }> {
    return this.documentStoragePolicy.storeCanonicalDocument({
      existingDocument: input.existingDocument,
      file: input.command.file,
      hash: input.hash,
      pageCount: input.pageCount,
      now: input.now,
      idGenerator: this.idGenerator,
      storage: this.storage
    });
  }

  private async persistAcceptedSubmission(input: {
    actor: AuditActor;
    document: DocumentRecord;
    storedNewBinary: boolean;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    forceReprocess: boolean;
    traceId: string;
    now: Date;
  }): Promise<{ job: ProcessingJobRecord; attempt: JobAttemptRecord }> {
    const validatedJob = markJobAsValidated({
      job: createSubmissionJob({
        jobId: this.idGenerator.next('job'),
        documentId: input.document.documentId,
        requestedMode: input.requestedMode,
        queueName: DEFAULT_PROCESSING_QUEUE_NAME,
        pipelineVersion: input.pipelineVersion,
        outputVersion: input.outputVersion,
        requestedBy: input.actor,
        forceReprocess: input.forceReprocess,
        now: input.now
      }),
      now: input.now
    });
    const storedJob = markJobAsStored({
      job: validatedJob,
      now: input.now
    });
    const job = markJobAsPublishPending({
      job: storedJob,
      now: input.now
    });
    const attempt = createPendingAttempt({
      attemptId: this.idGenerator.next('attempt'),
      jobId: job.jobId,
      attemptNumber: 1,
      pipelineVersion: job.pipelineVersion,
      now: input.now
    });

    try {
      await this.unitOfWork.runInTransaction(async () => {
        if (input.storedNewBinary) {
          await this.documents.save(input.document);
          await this.auditEventRecorder.record({
            eventType: 'DOCUMENT_STORED',
            aggregateType: 'DOCUMENT',
            aggregateId: input.document.documentId,
            traceId: input.traceId,
            actor: input.actor,
            metadata: {
              documentId: input.document.documentId,
              hash: input.document.hash
            },
            createdAt: input.now
          });
        }

        await this.jobs.save(job);
        await this.attempts.save(attempt);
        await this.outbox.save(
          buildOrchestratorQueuePublicationOutboxRecord({
            outboxId: this.idGenerator.next('outbox'),
            flowType: 'submission',
            dispatchKind: 'publish_requested',
            queueName: job.queueName,
            messageBase: {
              documentId: job.documentId,
              jobId: job.jobId,
              attemptId: attempt.attemptId,
              traceId: input.traceId,
              requestedMode: input.requestedMode,
              pipelineVersion: job.pipelineVersion
            },
            finalizationMetadata: {
              actor: input.actor,
              auditEventType: 'PROCESSING_JOB_QUEUED',
              auditAggregateType: 'PROCESSING_JOB',
              auditAggregateId: job.jobId,
              auditMetadata: {
                documentId: input.document.documentId,
                jobId: job.jobId,
                attemptId: attempt.attemptId,
                requestedMode: input.requestedMode
              }
            },
            now: input.now
          })
        );
        await this.auditEventRecorder.record({
          eventType: 'DOCUMENT_ACCEPTED',
          aggregateType: 'PROCESSING_JOB',
          aggregateId: job.jobId,
          traceId: input.traceId,
          actor: input.actor,
          metadata: {
            documentId: input.document.documentId,
            jobId: job.jobId,
            requestedMode: input.requestedMode,
            forceReprocess: input.forceReprocess
          },
          createdAt: input.now
        });
      });
    } catch (error) {
      if (input.storedNewBinary) {
        await this.storage.delete(input.document.storageReference);
      }
      throw error;
    }

    return { job, attempt };
  }

  private async finalizeDeduplicatedJob(input: {
    actor: AuditActor;
    compatibleResult: ProcessingResultRecord;
    compatibilityKey: string;
    documentId: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    traceId: string;
    now: Date;
  }): Promise<JobResponse> {
    const sourceJobId = input.compatibleResult.sourceJobId ?? input.compatibleResult.jobId;
    const job = createDeduplicatedJob({
      jobId: this.idGenerator.next('job'),
      documentId: input.documentId,
      requestedMode: input.requestedMode,
      queueName: DEFAULT_PROCESSING_QUEUE_NAME,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion,
      requestedBy: input.actor,
      compatibleResult: input.compatibleResult,
      now: input.now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(job);
      await this.results.save({
        resultId: this.idGenerator.next('result'),
        jobId: job.jobId,
        documentId: job.documentId,
        compatibilityKey: input.compatibilityKey,
        status: input.compatibleResult.status,
        requestedMode: input.requestedMode,
        pipelineVersion: input.pipelineVersion,
        outputVersion: input.outputVersion,
        confidence: input.compatibleResult.confidence,
        warnings: input.compatibleResult.warnings,
        payload: input.compatibleResult.payload,
        engineUsed: input.compatibleResult.engineUsed,
        totalLatencyMs: input.compatibleResult.totalLatencyMs,
        promptVersion: input.compatibleResult.promptVersion,
        modelVersion: input.compatibleResult.modelVersion,
        normalizationVersion: input.compatibleResult.normalizationVersion,
        sourceJobId,
        createdAt: input.now,
        updatedAt: input.now,
        retentionUntil: this.retentionPolicy.calculateProcessingResultRetentionUntil(input.now)
      });
      await this.auditEventRecorder.record({
        eventType: 'COMPATIBLE_RESULT_REUSED',
        aggregateType: 'PROCESSING_JOB',
        aggregateId: job.jobId,
        traceId: input.traceId,
        actor: input.actor,
        metadata: {
          documentId: input.documentId,
          jobId: job.jobId,
          sourceJobId,
          sourceResultId: input.compatibleResult.resultId
        },
        createdAt: input.now
      });
    });

    return toJobResponse(job);
  }
}
