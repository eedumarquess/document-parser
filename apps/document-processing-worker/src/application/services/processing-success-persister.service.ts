import { Inject, Injectable } from '@nestjs/common';
import { completeAttemptWithOutcome } from '@document-parser/document-processing-domain';
import { ArtifactType, RetentionPolicyService, type ProcessingOutcome } from '@document-parser/shared-kernel';
import type {
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  UnitOfWorkPort
} from '../../contracts/ports';
import { TOKENS } from '../../contracts/tokens';
import { ProcessingResultEntity } from '../../domain/entities/processing-result.entity';
import type { ProcessingExecutionContext } from './processing-execution-context';
import { AuditEventRecorder } from './audit-event-recorder.service';

@Injectable()
export class ProcessingSuccessPersister {
  public constructor(
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.JOB_REPOSITORY) private readonly jobs: ProcessingJobRepositoryPort,
    @Inject(TOKENS.ATTEMPT_REPOSITORY) private readonly attempts: JobAttemptRepositoryPort,
    @Inject(TOKENS.RESULT_REPOSITORY) private readonly results: ProcessingResultRepositoryPort,
    @Inject(TOKENS.PAGE_ARTIFACT_REPOSITORY) private readonly artifacts: PageArtifactRepositoryPort,
    @Inject(TOKENS.UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly auditEventRecorder: AuditEventRecorder
  ) {}

  public async persist(input: {
    context: ProcessingExecutionContext;
    outcome: ProcessingOutcome;
    now: Date;
  }): Promise<void> {
    const completed = completeAttemptWithOutcome({
      job: input.context.job,
      attempt: input.context.attempt,
      outcome: input.outcome,
      now: input.now
    });

    await this.unitOfWork.runInTransaction(async () => {
      await this.artifacts.saveMany(
        input.outcome.artifacts.map((artifact) => ({
          ...artifact,
          documentId: input.context.document.documentId,
          jobId: input.context.job.jobId,
          createdAt: input.now,
          retentionUntil: this.retentionPolicy.calculatePageArtifactRetentionUntil({
            artifactType: artifact.artifactType as ArtifactType,
            now: input.now
          })
        }))
      );

      await this.results.save(
        ProcessingResultEntity.create({
          resultId: this.idGenerator.next('result'),
          jobId: input.context.job.jobId,
          documentId: input.context.document.documentId,
          hash: input.context.document.hash,
          requestedMode: input.context.job.requestedMode,
          pipelineVersion: input.context.job.pipelineVersion,
          outputVersion: input.context.job.outputVersion,
          outcome: input.outcome,
          retentionUntil: this.retentionPolicy.calculateProcessingResultRetentionUntil(input.now),
          now: input.now
        })
      );

      await this.attempts.save(completed.attempt);
      await this.jobs.save(completed.job);
      await this.auditEventRecorder.record({
        eventType: 'PROCESSING_COMPLETED',
        aggregateType: 'JOB_ATTEMPT',
        aggregateId: completed.attempt.attemptId,
        traceId: input.context.message.traceId,
        metadata: {
          jobId: completed.job.jobId,
          attemptId: completed.attempt.attemptId,
          status: input.outcome.status
        },
        createdAt: input.now
      });
    });
  }
}
