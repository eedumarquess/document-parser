import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { ProcessingJobConsumer } from './adapters/in/queue/processing-job.consumer';
import { RandomIdGeneratorAdapter } from './adapters/out/clock/random-id-generator.adapter';
import { SystemClockAdapter } from './adapters/out/clock/system-clock.adapter';
import { SimulatedDocumentExtractionAdapter } from './adapters/out/extraction/simulated-document-extraction.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository
} from './adapters/out/repositories/in-memory.repositories';
import { ProcessJobMessageUseCase } from './application/use-cases/process-job-message.use-case';
import type {
  AuditPort,
  BinaryStoragePort,
  ClockPort,
  DeadLetterRepositoryPort,
  DocumentRepositoryPort,
  ExtractionPipelinePort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort
} from './contracts/ports';
import { TOKENS } from './contracts/tokens';
import { ProcessingOutcomePolicy } from './domain/policies/processing-outcome.policy';
import { RetryPolicyService } from './domain/policies/retry-policy.service';

export type WorkerProviderOverrides = Partial<{
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  storage: BinaryStoragePort;
  documents: DocumentRepositoryPort;
  jobs: ProcessingJobRepositoryPort;
  attempts: JobAttemptRepositoryPort;
  results: ProcessingResultRepositoryPort;
  artifacts: PageArtifactRepositoryPort;
  deadLetters: DeadLetterRepositoryPort;
  audit: AuditPort;
  publisher: JobPublisherPort;
  extraction: ExtractionPipelinePort;
}>;

@Module({})
export class DocumentProcessingWorkerModule {
  public static register(overrides: WorkerProviderOverrides): DynamicModule {
    const providers: Provider[] = [
      { provide: TOKENS.CLOCK, useValue: overrides.clock ?? new SystemClockAdapter() },
      { provide: TOKENS.ID_GENERATOR, useValue: overrides.idGenerator ?? new RandomIdGeneratorAdapter() },
      { provide: TOKENS.STORAGE, useValue: overrides.storage },
      { provide: TOKENS.DOCUMENT_REPOSITORY, useValue: overrides.documents ?? new InMemoryDocumentRepository() },
      { provide: TOKENS.JOB_REPOSITORY, useValue: overrides.jobs ?? new InMemoryProcessingJobRepository() },
      { provide: TOKENS.ATTEMPT_REPOSITORY, useValue: overrides.attempts ?? new InMemoryJobAttemptRepository() },
      { provide: TOKENS.RESULT_REPOSITORY, useValue: overrides.results ?? new InMemoryProcessingResultRepository() },
      {
        provide: TOKENS.PAGE_ARTIFACT_REPOSITORY,
        useValue: overrides.artifacts ?? new InMemoryPageArtifactRepository()
      },
      {
        provide: TOKENS.DEAD_LETTER_REPOSITORY,
        useValue: overrides.deadLetters ?? new InMemoryDeadLetterRepository()
      },
      { provide: TOKENS.AUDIT, useValue: overrides.audit ?? new InMemoryAuditRepository() },
      { provide: TOKENS.JOB_PUBLISHER, useValue: overrides.publisher },
      ProcessingOutcomePolicy,
      RetryPolicyService,
      {
        provide: TOKENS.EXTRACTION_PIPELINE,
        useFactory: (policy: ProcessingOutcomePolicy) =>
          overrides.extraction ?? new SimulatedDocumentExtractionAdapter(policy),
        inject: [ProcessingOutcomePolicy]
      },
      ProcessJobMessageUseCase,
      ProcessingJobConsumer
    ];

    return {
      module: DocumentProcessingWorkerModule,
      providers,
      exports: providers
    };
  }
}

