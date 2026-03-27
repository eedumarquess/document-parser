import { DynamicModule, Module, type Provider } from '@nestjs/common';
import {
  createFanOutObservabilityAdapters,
  JsonConsoleLoggingAdapter,
  JsonConsoleMetricsAdapter,
  JsonConsoleTracingAdapter,
  RedactionPolicyService,
  RetentionPolicyService
} from '@document-parser/shared-kernel';
import { ProcessingJobConsumer } from './adapters/in/queue/processing-job.consumer';
import { RandomIdGeneratorAdapter } from './adapters/out/clock/random-id-generator.adapter';
import { SystemClockAdapter } from './adapters/out/clock/system-clock.adapter';
import { createDefaultExtractionPipeline } from './adapters/out/extraction/default-extraction.factory';
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
import { AuditEventRecorder } from './application/services/audit-event-recorder.service';
import { AttemptExecutionCoordinator } from './application/services/attempt-execution-coordinator.service';
import { ProcessingContextLoader } from './application/services/processing-context-loader.service';
import { ProcessingFailureRecoveryService } from './application/services/processing-failure-recovery.service';
import { ProcessingSuccessPersister } from './application/services/processing-success-persister.service';
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
  LoggingPort,
  MetricsPort,
  PageArtifactRepositoryPort,
  ProcessingJobRepositoryPort,
  ProcessingResultRepositoryPort,
  TelemetryEventRepositoryPort,
  TracingPort,
  UnitOfWorkPort
} from './contracts/ports';
import { TOKENS } from './contracts/tokens';
import type {
  LlmExtractionPort,
  OcrEnginePort,
  PageRendererPort
} from './domain/extraction/extraction-ports';
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
  telemetry: TelemetryEventRepositoryPort;
  logging: LoggingPort;
  metrics: MetricsPort;
  tracing: TracingPort;
  publisher: JobPublisherPort;
  unitOfWork: UnitOfWorkPort;
  pageRenderer: PageRendererPort;
  ocrEngine: OcrEnginePort;
  llmExtraction: LlmExtractionPort;
  extraction: ExtractionPipelinePort;
  serviceName: string;
}>;

@Module({})
export class DocumentProcessingWorkerModule {
  public static register(overrides: WorkerProviderOverrides = {}): DynamicModule {
    const telemetry = overrides.telemetry ?? new InMemoryTelemetryEventRepository();
    const observability = createFanOutObservabilityAdapters({
      serviceName: overrides.serviceName ?? 'document-parser-worker',
      sink: telemetry,
      logging: overrides.logging ?? new JsonConsoleLoggingAdapter(),
      metrics: overrides.metrics ?? new JsonConsoleMetricsAdapter(),
      tracing: overrides.tracing ?? new JsonConsoleTracingAdapter()
    });
    const providers: Provider[] = [
      { provide: TOKENS.CLOCK, useValue: overrides.clock ?? new SystemClockAdapter() },
      { provide: TOKENS.ID_GENERATOR, useValue: overrides.idGenerator ?? new RandomIdGeneratorAdapter() },
      {
        provide: TOKENS.STORAGE,
        useValue:
          overrides.storage ??
          ({
            async read(): Promise<Buffer> {
              return Buffer.alloc(0);
            }
          } satisfies BinaryStoragePort)
      },
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
      { provide: TOKENS.TELEMETRY_REPOSITORY, useValue: telemetry },
      { provide: TOKENS.LOGGING, useValue: observability.logging },
      { provide: TOKENS.METRICS, useValue: observability.metrics },
      { provide: TOKENS.TRACING, useValue: observability.tracing },
      {
        provide: TOKENS.JOB_PUBLISHER,
        useValue:
          overrides.publisher ??
          ({
            async publishRequested(): Promise<void> {
              return;
            },
            async publishRetry(): Promise<void> {
              return;
            }
          } satisfies JobPublisherPort)
      },
      { provide: TOKENS.UNIT_OF_WORK, useValue: overrides.unitOfWork ?? new InMemoryUnitOfWork() },
      ProcessingOutcomePolicy,
      RetryPolicyService,
      RetentionPolicyService,
      RedactionPolicyService,
      AuditEventRecorder,
      ProcessingContextLoader,
      AttemptExecutionCoordinator,
      ProcessingSuccessPersister,
      ProcessingFailureRecoveryService,
      {
        provide: TOKENS.EXTRACTION_PIPELINE,
        useFactory: (
          policy: ProcessingOutcomePolicy,
          metrics: MetricsPort,
          tracing: TracingPort
        ) =>
          overrides.extraction ??
          createDefaultExtractionPipeline(policy, overrides, {
            metrics,
            tracing
          }),
        inject: [ProcessingOutcomePolicy, TOKENS.METRICS, TOKENS.TRACING]
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
