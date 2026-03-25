# DDD: Document Processing

## Objetivo

Orquestrar o ciclo de vida do processamento assíncrono, incluindo estado do job, tentativas, retries, reprocessamentos e consolidação do resultado.

## Responsabilidades

- Controlar estados de `ProcessingJob`
- Registrar tentativas de execução
- Coordenar retry, fallback e DLQ
- Consolidar versões de pipeline e contrato
- Encerrar o job com sucesso, parcialidade ou falha

## Agregados principais

### `ProcessingJob`

Representa o pedido assíncrono de processamento.

#### Atributos principais

- `jobId`
- `documentId`
- `requestedMode`
- `status`
- `priority`
- `queueName`
- `forceReprocess`
- `reusedResult`
- `timestamps`

#### Estados sugeridos

- `RECEIVED`
- `VALIDATED`
- `STORED`
- `DEDUPLICATED`
- `QUEUED`
- `PROCESSING`
- `PARTIAL`
- `COMPLETED`
- `FAILED`
- `REPROCESSED`

### `JobAttempt`

Representa uma tentativa concreta de execução do job por uma pipeline específica.

#### Atributos principais

- `attemptId`
- `jobId`
- `attemptNumber`
- `enginePlan`
- `pipelineVersion`
- `promptVersion`
- `modelVersion`
- `normalizationVersion`
- `fallbackUsed`
- `latencyMs`
- `status`

## Regras de negócio

- Todo processamento acontece via job, sem caminho síncrono alternativo
- Um job pode ter múltiplas tentativas, mas apenas um resultado final ativo por versão
- Reprocessamento gera nova execução versionada sem sobrescrever histórico anterior
- Falha terminal deve produzir informação suficiente para auditoria e replay manual

## Value objects

- `ProcessingMode`
- `ProcessingStatus`
- `AttemptStatus`
- `VersionStamp`
- `LatencyBudget`
- `FallbackDecision`

## Serviços de domínio

- `JobLifecycleService`
- `RetryPolicyService`
- `ReprocessingPolicyService`
- `ResultVersioningService`

## Repositórios

- `ProcessingJobRepository`
- `JobAttemptRepository`
- `ProcessingResultRepository`

## Eventos de domínio

- `ProcessingQueued`
- `ProcessingStarted`
- `ProcessingAttemptFailed`
- `ProcessingFallbackActivated`
- `ProcessingCompleted`
- `ProcessingPartiallyCompleted`
- `ProcessingFailed`
- `ProcessingReprocessed`

## Portas

### Entrada

- `StartProcessingJobCommand`
- `CompleteProcessingJobCommand`
- `FailProcessingJobCommand`
- `ReprocessJobCommand`

### Saída

- `QueueConsumerPort`
- `QueuePublisherPort`
- `MetricsPort`
- `TracePort`
- `DeadLetterPort`

## Fronteira de serviço

- No `orchestrator-api`, este domínio cria e acompanha o job
- No `document-processing-worker`, este domínio governa a execução e devolve o encerramento
