import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  ErrorCode,
  JobStatus,
  TransientFailureError,
  type AuditActor,
  type ProcessingJobRequestedMessage,
  ValidationError
} from '@document-parser/shared-kernel';
import { ProcessingJobEntity } from '../../domain/entities/processing-job.entity';
import { CompatibleResultReusePolicy } from '../../domain/policies/compatible-result-reuse.policy';
import { DocumentAcceptancePolicy } from '../../domain/policies/document-acceptance.policy';
import { DocumentStoragePolicy } from '../../domain/policies/document-storage.policy';
import { PageCountPolicy } from '../../domain/policies/page-count.policy';
import { DocumentHash } from '../../domain/value-objects/document-hash';
import { CompatibilityKey } from '../../domain/value-objects/compatibility-key';
import type { JobResponse } from '../../contracts/http';
import type { DocumentRecord, ProcessingJobRecord, ProcessingResultRecord } from '../../contracts/models';
import type {
  AuditPort,
  AuthorizationPort,
  BinaryStoragePort,
  ClockPort,
  CompatibleResultLookupPort,
  DocumentRepositoryPort,
  HashingPort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  PageCounterPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type { SubmitDocumentCommand } from '../commands/submit-document.command';

@Injectable()
export class SubmitDocumentUseCase {
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
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly acceptancePolicy: DocumentAcceptancePolicy,
    private readonly reusePolicy: CompatibleResultReusePolicy,
    private readonly pageCountPolicy: PageCountPolicy,
    private readonly documentStoragePolicy: DocumentStoragePolicy
  ) {}

  public async execute(command: SubmitDocumentCommand, actor: AuditActor): Promise<JobResponse> {
    this.authorizeSubmission(actor);
    this.ensureUploadedFileIsNotEmpty(command);

    const pageCount = await this.countDocumentPages(command);
    this.validateUploadedFileConstraints(command, pageCount);

    const hash = await this.calculateDocumentHash(command);
    const now = this.clock.now();
    const requestedMode = command.requestedMode;
    const pipelineVersion = DEFAULT_PIPELINE_VERSION;
    const outputVersion = DEFAULT_OUTPUT_VERSION;
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

    if (this.reusePolicy.shouldReuse({ compatibleResult, forceReprocess: command.forceReprocess })) {
      return this.finalizeDeduplicatedJob({
        actor,
        compatibleResult: compatibleResult as ProcessingResultRecord,
        compatibilityKey,
        documentId: existingDocument?.documentId ?? (compatibleResult as ProcessingResultRecord).documentId,
        requestedMode,
        pipelineVersion,
        outputVersion,
        now
      });
    }

    const canonicalDocument = await this.storeOriginalDocumentBinaryWhenNeeded({
      command,
      existingDocument,
      hash,
      pageCount,
      now
    });
    const storedJob = await this.persistAcceptedSubmission({
      actor,
      document: canonicalDocument.document,
      storedNewBinary: canonicalDocument.storedNewBinary,
      requestedMode,
      pipelineVersion,
      outputVersion,
      forceReprocess: command.forceReprocess,
      now
    });
    const attemptId = this.idGenerator.next('attempt');

    try {
      await this.publishProcessingJobRequested({
        documentId: canonicalDocument.document.documentId,
        jobId: storedJob.jobId,
        attemptId,
        requestedMode,
        pipelineVersion,
        publishedAt: now.toISOString()
      });
    } catch (error) {
      await this.markJobAsPublishFailed({
        actor,
        job: storedJob,
        now,
        errorMessage: this.buildPublishErrorMessage(error)
      });
      throw new TransientFailureError('Processing job persisted but queue publication failed', {
        jobId: storedJob.jobId,
        documentId: storedJob.documentId
      });
    }

    const queuedJob = await this.finalizeQueuedJob({
      actor,
      job: storedJob,
      attemptId,
      now
    });

    return this.toJobResponse(queuedJob);
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
    now: Date;
  }): Promise<ProcessingJobRecord> {
    const job = input.forceReprocess
      ? ProcessingJobEntity.createReprocessed({
          jobId: this.idGenerator.next('job'),
          documentId: input.document.documentId,
          requestedMode: input.requestedMode,
          pipelineVersion: input.pipelineVersion,
          outputVersion: input.outputVersion,
          requestedBy: input.actor,
          now: input.now,
          transitions: [
            { status: JobStatus.RECEIVED, at: input.now },
            { status: JobStatus.VALIDATED, at: input.now },
            { status: JobStatus.STORED, at: input.now },
            { status: JobStatus.REPROCESSED, at: input.now }
          ]
        })
      : ProcessingJobEntity.createStored({
          jobId: this.idGenerator.next('job'),
          documentId: input.document.documentId,
          requestedMode: input.requestedMode,
          pipelineVersion: input.pipelineVersion,
          outputVersion: input.outputVersion,
          requestedBy: input.actor,
          forceReprocess: false,
          now: input.now
        });

    try {
      await this.unitOfWork.runInTransaction(async () => {
        if (input.storedNewBinary) {
          await this.documents.save(input.document);
          await this.audit.record({
            eventId: this.idGenerator.next('audit'),
            eventType: 'DOCUMENT_STORED',
            actor: input.actor,
            metadata: {
              documentId: input.document.documentId,
              hash: input.document.hash
            },
            createdAt: input.now
          });
        }

        await this.jobs.save(job);
        await this.audit.record({
          eventId: this.idGenerator.next('audit'),
          eventType: 'DOCUMENT_ACCEPTED',
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

    return job;
  }

  private async publishProcessingJobRequested(message: ProcessingJobRequestedMessage): Promise<void> {
    await this.publisher.publish(message);
  }

  private async finalizeQueuedJob(input: {
    actor: AuditActor;
    job: ProcessingJobRecord;
    attemptId: string;
    now: Date;
  }): Promise<ProcessingJobRecord> {
    const queuedJob = ProcessingJobEntity.markQueued({
      job: input.job,
      now: input.now
    });
    const attempt = ProcessingJobEntity.createAttempt({
      attemptId: input.attemptId,
      jobId: input.job.jobId,
      attemptNumber: 1,
      pipelineVersion: input.job.pipelineVersion,
      now: input.now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save(queuedJob);
      await this.attempts.save(attempt);
      await this.audit.record({
        eventId: this.idGenerator.next('audit'),
        eventType: 'PROCESSING_JOB_QUEUED',
        actor: input.actor,
        metadata: {
          documentId: input.job.documentId,
          jobId: input.job.jobId,
          attemptId: input.attemptId,
          requestedMode: input.job.requestedMode
        },
        createdAt: input.now
      });
    });

    return queuedJob;
  }

  private async finalizeDeduplicatedJob(input: {
    actor: AuditActor;
    compatibleResult: ProcessingResultRecord;
    compatibilityKey: string;
    documentId: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    now: Date;
  }): Promise<JobResponse> {
    const job = ProcessingJobEntity.createDeduplicated({
      jobId: this.idGenerator.next('job'),
      documentId: input.documentId,
      requestedMode: input.requestedMode,
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
        sourceJobId: input.compatibleResult.jobId,
        createdAt: input.now,
        updatedAt: input.now
      });
      await this.audit.record({
        eventId: this.idGenerator.next('audit'),
        eventType: 'COMPATIBLE_RESULT_REUSED',
        actor: input.actor,
        metadata: {
          documentId: input.documentId,
          jobId: job.jobId,
          sourceJobId: input.compatibleResult.jobId,
          sourceResultId: input.compatibleResult.resultId
        },
        createdAt: input.now
      });
    });

    return this.toJobResponse(job);
  }

  private async markJobAsPublishFailed(input: {
    actor: AuditActor;
    job: ProcessingJobRecord;
    now: Date;
    errorMessage: string;
  }): Promise<void> {
    await this.unitOfWork.runInTransaction(async () => {
      await this.jobs.save({
        ...input.job,
        errorCode: ErrorCode.TRANSIENT_FAILURE,
        errorMessage: input.errorMessage,
        updatedAt: input.now
      });
      await this.audit.record({
        eventId: this.idGenerator.next('audit'),
        eventType: 'PROCESSING_JOB_QUEUEING_FAILED',
        actor: input.actor,
        metadata: {
          documentId: input.job.documentId,
          jobId: input.job.jobId,
          errorMessage: input.errorMessage
        },
        createdAt: input.now
      });
    });
  }

  private buildPublishErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unexpected queue publishing failure';
  }

  private toJobResponse(job: {
    jobId: string;
    documentId: string;
    status: JobStatus;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    reusedResult: boolean;
    createdAt: Date;
  }): JobResponse {
    return {
      jobId: job.jobId,
      documentId: job.documentId,
      status: job.status,
      requestedMode: job.requestedMode,
      pipelineVersion: job.pipelineVersion,
      outputVersion: job.outputVersion,
      reusedResult: job.reusedResult,
      createdAt: job.createdAt.toISOString()
    };
  }
}
