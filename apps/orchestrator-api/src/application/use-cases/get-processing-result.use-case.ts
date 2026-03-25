import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type AuditActor } from '@document-parser/shared-kernel';
import type { ResultResponse } from '../../contracts/http';
import type {
  AuditPort,
  AuthorizationPort,
  ClockPort,
  IdGeneratorPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type { GetProcessingResultQuery } from '../queries/get-processing-result.query';

@Injectable()
export class GetProcessingResultUseCase {
  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.CLOCK) private readonly clock: ClockPort,
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.RESULT_REPOSITORY) private readonly results: ProcessingResultRepositoryPort,
    @Inject(TOKENS.AUDIT) private readonly audit: AuditPort
  ) {}

  public async execute(query: GetProcessingResultQuery, actor: AuditActor): Promise<ResultResponse> {
    this.authorization.ensureCanRead(actor);
    const job = await this.jobs.findById(query.jobId);
    if (job === undefined) {
      throw new NotFoundError('Processing job not found', { jobId: query.jobId });
    }

    const result = await this.results.findByJobId(query.jobId);
    if (result === undefined) {
      throw new NotFoundError('Processing result not available yet', { jobId: query.jobId });
    }

    await this.audit.record({
      eventId: this.idGenerator.next('audit'),
      eventType: 'RESULT_QUERIED',
      actor,
      metadata: {
        jobId: query.jobId,
        documentId: job.documentId
      },
      createdAt: this.clock.now()
    });

    return {
      jobId: result.jobId,
      documentId: result.documentId,
      status: result.status,
      requestedMode: result.requestedMode,
      pipelineVersion: result.pipelineVersion,
      outputVersion: result.outputVersion,
      confidence: result.confidence,
      warnings: result.warnings,
      payload: result.payload
    };
  }
}

