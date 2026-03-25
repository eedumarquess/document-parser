import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  JobStatus,
  type AuditActor,
  type ProcessingJobRequestedMessage,
  ValidationError
} from '@document-parser/shared-kernel';
import { DocumentEntity } from '../../domain/entities/document.entity';
import { ProcessingJobEntity } from '../../domain/entities/processing-job.entity';
import { CompatibleResultReusePolicy } from '../../domain/policies/compatible-result-reuse.policy';
import { DocumentAcceptancePolicy } from '../../domain/policies/document-acceptance.policy';
import { RetentionPolicyService } from '../../domain/services/retention-policy.service';
import { DocumentHash } from '../../domain/value-objects/document-hash';
import type { JobResponse } from '../../contracts/http';
import type { ProcessingResultRecord } from '../../contracts/models';
import type {
  AuditPort,
  AuthorizationPort,
  BinaryStoragePort,
  ClockPort,
  DocumentRepositoryPort,
  HashingPort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  PageCounterPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort
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
    @Inject(TOKENS.JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort,
    private readonly acceptancePolicy: DocumentAcceptancePolicy,
    private readonly reusePolicy: CompatibleResultReusePolicy,
    private readonly retentionPolicy: RetentionPolicyService
  ) {}

  public async execute(command: SubmitDocumentCommand, actor: AuditActor): Promise<JobResponse> {
    this.authorization.ensureCanSubmit(actor);

    if (command.file.buffer.length === 0) {
      throw new ValidationError('Uploaded file cannot be empty');
    }

    const pageCount = await this.pageCounter.countPages(command.file);
    this.acceptancePolicy.validate({
      mimeType: command.file.mimeType,
      fileSizeBytes: command.file.size,
      pageCount
    });

    const hash = DocumentHash.create(await this.hashing.calculateHash(command.file.buffer)).value;
    const now = this.clock.now();
    const requestedMode = command.requestedMode;
    const pipelineVersion = DEFAULT_PIPELINE_VERSION;
    const outputVersion = DEFAULT_OUTPUT_VERSION;

    let document = await this.documents.findByHash(hash);
    if (document === undefined) {
      const documentId = this.idGenerator.next('doc');
      const storageReference = await this.storage.storeOriginal({
        documentId,
        mimeType: command.file.mimeType,
        originalName: command.file.originalName,
        buffer: command.file.buffer
      });

      document = DocumentEntity.create({
        documentId,
        hash,
        originalFileName: command.file.originalName,
        mimeType: command.file.mimeType,
        fileSizeBytes: command.file.size,
        pageCount,
        storageReference,
        retentionUntil: this.retentionPolicy.calculateOriginalRetentionUntil(now),
        now
      });
      await this.documents.save(document);
    }

    const compatibleResult = command.forceReprocess
      ? undefined
      : await this.results.findCompatibleResult({
          documentId: document.documentId,
          requestedMode,
          pipelineVersion,
          outputVersion
        });

    if (this.reusePolicy.shouldReuse({ compatibleResult, forceReprocess: command.forceReprocess })) {
      return this.finalizeDeduplicatedJob({
        actor,
        compatibleResult: compatibleResult as ProcessingResultRecord,
        documentId: document.documentId,
        requestedMode,
        pipelineVersion,
        outputVersion,
        now
      });
    }

    const jobId = this.idGenerator.next('job');
    const attemptId = this.idGenerator.next('attempt');
    const job = ProcessingJobEntity.createQueued({
      jobId,
      documentId: document.documentId,
      requestedMode,
      pipelineVersion,
      outputVersion,
      requestedBy: actor,
      forceReprocess: command.forceReprocess,
      now
    });
    const attempt = ProcessingJobEntity.createAttempt({
      attemptId,
      jobId,
      attemptNumber: 1,
      pipelineVersion,
      now
    });

    await this.jobs.save(job);
    await this.attempts.save(attempt);

    const message: ProcessingJobRequestedMessage = {
      documentId: document.documentId,
      jobId,
      attemptId,
      requestedMode,
      pipelineVersion,
      publishedAt: now.toISOString()
    };

    await this.publisher.publish(message);
    await this.audit.record({
      eventId: this.idGenerator.next('audit'),
      eventType: 'PROCESSING_JOB_QUEUED',
      actor,
      metadata: {
        documentId: document.documentId,
        jobId,
        requestedMode
      },
      createdAt: now
    });

    return this.toJobResponse(job);
  }

  private async finalizeDeduplicatedJob(input: {
    actor: AuditActor;
    compatibleResult: ProcessingResultRecord;
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

    await this.jobs.save(job);
    await this.results.save({
      resultId: this.idGenerator.next('result'),
      jobId: job.jobId,
      documentId: job.documentId,
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

    return this.toJobResponse(job);
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

