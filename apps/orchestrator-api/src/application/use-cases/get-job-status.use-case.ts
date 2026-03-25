import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type AuditActor } from '@document-parser/shared-kernel';
import type { JobResponse } from '../../contracts/http';
import type { AuthorizationPort, ProcessingJobRepositoryPort } from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import type { GetJobStatusQuery } from '../queries/get-job-status.query';

@Injectable()
export class GetJobStatusUseCase {
  public constructor(
    @Inject(TOKENS.AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort
  ) {}

  public async execute(query: GetJobStatusQuery, actor: AuditActor): Promise<JobResponse> {
    this.authorization.ensureCanRead(actor);
    const job = await this.jobs.findById(query.jobId);
    if (job === undefined) {
      throw new NotFoundError('Processing job not found', { jobId: query.jobId });
    }

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

