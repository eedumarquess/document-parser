import { DynamicModule, Module, type Provider } from '@nestjs/common';
import {
  createFanOutObservabilityAdapters,
  JsonConsoleLoggingAdapter,
  JsonConsoleMetricsAdapter,
  JsonConsoleTracingAdapter,
  RedactionPolicyService
} from '@document-parser/shared-kernel';
import { DeadLettersController } from './adapters/in/http/dead-letters.controller';
import { DocumentJobsController } from './adapters/in/http/document-jobs.controller';
import { OperationalJobsController } from './adapters/in/http/operational-jobs.controller';
import { SimpleRbacAuthorizationAdapter } from './adapters/out/auth/simple-rbac.adapter';
import { RandomIdGeneratorAdapter } from './adapters/out/clock/random-id-generator.adapter';
import { SystemClockAdapter } from './adapters/out/clock/system-clock.adapter';
import { InMemoryJobPublisherAdapter } from './adapters/out/queue/in-memory-job-publisher.adapter';
import {
  InMemoryAuditRepository,
  InMemoryDeadLetterRepository,
  InMemoryDocumentRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryTelemetryEventRepository,
  InMemoryUnitOfWork
} from './adapters/out/repositories/in-memory.repositories';
import { InMemoryBinaryStorageAdapter } from './adapters/out/storage/in-memory-binary-storage.adapter';
import { Sha256HashingAdapter } from './adapters/out/storage/sha256-hashing.adapter';
import { SimplePageCounterAdapter } from './adapters/out/storage/simple-page-counter.adapter';
import { GetJobStatusUseCase } from './application/use-cases/get-job-status.use-case';
import { GetJobOperationalContextUseCase } from './application/use-cases/get-job-operational-context.use-case';
import { GetProcessingResultUseCase } from './application/use-cases/get-processing-result.use-case';
import { AuditEventRecorder } from './application/services/audit-event-recorder.service';
import { ArtifactPreviewService } from './application/services/artifact-preview.service';
import { DerivedJobOrchestrator } from './application/services/derived-job-orchestrator.service';
import { QueuePublicationFailureHandler } from './application/services/queue-publication-failure-handler.service';
import { ReplayDeadLetterUseCase } from './application/use-cases/replay-dead-letter.use-case';
import { ReprocessDocumentUseCase } from './application/use-cases/reprocess-document.use-case';
import { SubmitDocumentUseCase } from './application/use-cases/submit-document.use-case';
import type {
  AuditPort,
  AuthorizationPort,
  BinaryStoragePort,
  ClockPort,
  CompatibleResultLookupPort,
  DeadLetterRepositoryPort,
  DocumentRepositoryPort,
  HashingPort,
  IdGeneratorPort,
  JobAttemptRepositoryPort,
  JobPublisherPort,
  LoggingPort,
  MetricsPort,
  PageCounterPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  TelemetryEventRepositoryPort,
  TracingPort,
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
  artifacts: PageArtifactRepositoryPort;
  deadLetters: DeadLetterRepositoryPort;
  compatibleResults: CompatibleResultLookupPort;
  publisher: JobPublisherPort;
  audit: AuditPort;
  telemetry: TelemetryEventRepositoryPort;
  logging: LoggingPort;
  metrics: MetricsPort;
  tracing: TracingPort;
  authorization: AuthorizationPort;
  unitOfWork: UnitOfWorkPort;
  serviceName: string;
}>;

@Module({})
export class OrchestratorApiModule {
  public static register(overrides: OrchestratorProviderOverrides = {}): DynamicModule {
    const results = overrides.results ?? new InMemoryProcessingResultRepository();
    const telemetry = overrides.telemetry ?? new InMemoryTelemetryEventRepository();
    const observability = createFanOutObservabilityAdapters({
      serviceName: overrides.serviceName ?? 'document-parser-orchestrator-api',
      sink: telemetry,
      logging: overrides.logging ?? new JsonConsoleLoggingAdapter(),
      metrics: overrides.metrics ?? new JsonConsoleMetricsAdapter(),
      tracing: overrides.tracing ?? new JsonConsoleTracingAdapter()
    });
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
        provide: TOKENS.PAGE_ARTIFACT_REPOSITORY,
        useValue: overrides.artifacts ?? new InMemoryPageArtifactRepository()
      },
      {
        provide: TOKENS.DEAD_LETTER_REPOSITORY,
        useValue: overrides.deadLetters ?? new InMemoryDeadLetterRepository()
      },
      {
        provide: TOKENS.COMPATIBLE_RESULT_LOOKUP,
        useValue: overrides.compatibleResults ?? results
      },
      { provide: TOKENS.TELEMETRY_REPOSITORY, useValue: telemetry },
      { provide: TOKENS.UNIT_OF_WORK, useValue: overrides.unitOfWork ?? new InMemoryUnitOfWork() },
      { provide: TOKENS.JOB_PUBLISHER, useValue: overrides.publisher ?? new InMemoryJobPublisherAdapter() },
      { provide: TOKENS.AUDIT, useValue: overrides.audit ?? new InMemoryAuditRepository() },
      { provide: TOKENS.LOGGING, useValue: observability.logging },
      { provide: TOKENS.METRICS, useValue: observability.metrics },
      { provide: TOKENS.TRACING, useValue: observability.tracing },
      {
        provide: TOKENS.AUTHORIZATION,
        useValue: overrides.authorization ?? new SimpleRbacAuthorizationAdapter()
      },
      DocumentAcceptancePolicy,
      CompatibleResultReusePolicy,
      PageCountPolicy,
      DocumentStoragePolicy,
      RetentionPolicyService,
      RedactionPolicyService,
      AuditEventRecorder,
      ArtifactPreviewService,
      QueuePublicationFailureHandler,
      DerivedJobOrchestrator,
      SubmitDocumentUseCase,
      GetJobStatusUseCase,
      GetProcessingResultUseCase,
      GetJobOperationalContextUseCase,
      ReprocessDocumentUseCase,
      ReplayDeadLetterUseCase
    ];

    return {
      module: OrchestratorApiModule,
      controllers: [DocumentJobsController, DeadLettersController, OperationalJobsController],
      providers,
      exports: providers
    };
  }
}
