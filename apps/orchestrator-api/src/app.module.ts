import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { DocumentJobsController } from './adapters/in/http/document-jobs.controller';
import { SimpleRbacAuthorizationAdapter } from './adapters/out/auth/simple-rbac.adapter';
import { RandomIdGeneratorAdapter } from './adapters/out/clock/random-id-generator.adapter';
import { SystemClockAdapter } from './adapters/out/clock/system-clock.adapter';
import { InMemoryJobPublisherAdapter } from './adapters/out/queue/in-memory-job-publisher.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryUnitOfWork
} from './adapters/out/repositories/in-memory.repositories';
import { InMemoryBinaryStorageAdapter } from './adapters/out/storage/in-memory-binary-storage.adapter';
import { Sha256HashingAdapter } from './adapters/out/storage/sha256-hashing.adapter';
import { SimplePageCounterAdapter } from './adapters/out/storage/simple-page-counter.adapter';
import { GetJobStatusUseCase } from './application/use-cases/get-job-status.use-case';
import { GetProcessingResultUseCase } from './application/use-cases/get-processing-result.use-case';
import { ReprocessDocumentUseCase } from './application/use-cases/reprocess-document.use-case';
import { SubmitDocumentUseCase } from './application/use-cases/submit-document.use-case';
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
} from './contracts/ports';
import { TOKENS } from './contracts/tokens';
import { CompatibleResultReusePolicy } from './domain/policies/compatible-result-reuse.policy';
import { DocumentStoragePolicy } from './domain/policies/document-storage.policy';
import { DocumentAcceptancePolicy } from './domain/policies/document-acceptance.policy';
import { PageCountPolicy } from './domain/policies/page-count.policy';
import { RetentionPolicyService } from './domain/services/retention-policy.service';

export type OrchestratorProviderOverrides = Partial<{
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  hashing: HashingPort;
  pageCounter: PageCounterPort;
  storage: BinaryStoragePort;
  documents: DocumentRepositoryPort;
  jobs: ProcessingJobRepositoryPort;
  attempts: JobAttemptRepositoryPort;
  results: ProcessingResultRepositoryPort;
  compatibleResults: CompatibleResultLookupPort;
  publisher: JobPublisherPort;
  audit: AuditPort;
  authorization: AuthorizationPort;
  unitOfWork: UnitOfWorkPort;
}>;

@Module({})
export class OrchestratorApiModule {
  public static register(overrides: OrchestratorProviderOverrides = {}): DynamicModule {
    const results = overrides.results ?? new InMemoryProcessingResultRepository();
    const providers: Provider[] = [
      { provide: TOKENS.CLOCK, useValue: overrides.clock ?? new SystemClockAdapter() },
      { provide: TOKENS.ID_GENERATOR, useValue: overrides.idGenerator ?? new RandomIdGeneratorAdapter() },
      { provide: TOKENS.HASHING, useValue: overrides.hashing ?? new Sha256HashingAdapter() },
      { provide: TOKENS.PAGE_COUNTER, useValue: overrides.pageCounter ?? new SimplePageCounterAdapter() },
      { provide: TOKENS.BINARY_STORAGE, useValue: overrides.storage ?? new InMemoryBinaryStorageAdapter() },
      { provide: TOKENS.DOCUMENT_REPOSITORY, useValue: overrides.documents ?? new InMemoryDocumentRepository() },
      { provide: TOKENS.JOB_REPOSITORY, useValue: overrides.jobs ?? new InMemoryProcessingJobRepository() },
      { provide: TOKENS.ATTEMPT_REPOSITORY, useValue: overrides.attempts ?? new InMemoryJobAttemptRepository() },
      { provide: TOKENS.RESULT_REPOSITORY, useValue: results },
      {
        provide: TOKENS.COMPATIBLE_RESULT_LOOKUP,
        useValue: overrides.compatibleResults ?? results
      },
      { provide: TOKENS.UNIT_OF_WORK, useValue: overrides.unitOfWork ?? new InMemoryUnitOfWork() },
      { provide: TOKENS.JOB_PUBLISHER, useValue: overrides.publisher ?? new InMemoryJobPublisherAdapter() },
      { provide: TOKENS.AUDIT, useValue: overrides.audit ?? new InMemoryAuditRepository() },
      {
        provide: TOKENS.AUTHORIZATION,
        useValue: overrides.authorization ?? new SimpleRbacAuthorizationAdapter()
      },
      DocumentAcceptancePolicy,
      CompatibleResultReusePolicy,
      PageCountPolicy,
      DocumentStoragePolicy,
      RetentionPolicyService,
      SubmitDocumentUseCase,
      GetJobStatusUseCase,
      GetProcessingResultUseCase,
      ReprocessDocumentUseCase
    ];

    return {
      module: OrchestratorApiModule,
      controllers: [DocumentJobsController],
      providers,
      exports: providers
    };
  }
}
