# DDD: Document Processing

## Objetivo

Governar o ciclo de vida do `ProcessingJob`, controlar tentativas, retries, DLQ, reprocessamento e consolidacao das versoes tecnicas do processamento.

## Decisoes fechadas do MVP

- Todo processamento e assincrono
- `requestedMode` inicial: `STANDARD`
- `priority` inicial: `NORMAL`
- `orchestrator-api` e worker compartilham o mesmo banco no MVP
- O payload minimo da fila contem `documentId`, `jobId`, `attemptId`, `requestedMode`, `pipelineVersion`, `publishedAt`
- Retry exponencial com no maximo `3` tentativas
- Falha apos o limite de retry vai para DLQ
- Reprocessamento cria novo job para o mesmo `documentId` e preserva todo o historico anterior
- `pipelineVersion`, `normalizationVersion`, `promptVersion` e `modelVersion` usam `Git SHA`
- `outputVersion` usa `SemVer`

## Agregado `ProcessingJob`

Representa o pedido assincrono de processamento de um `Document`.

### Atributos principais

- `jobId`
- `documentId`
- `requestedMode`
- `priority`
- `status`
- `reusedResult`
- `forceReprocess`
- `reprocessOfJobId`
- `sourceResultId`
- `pipelineVersion`
- `outputVersion`
- `acceptedAt`
- `queuedAt`
- `startedAt`
- `finishedAt`
- `errorCode`
- `errorMessage`
- `warnings`

### Estados oficiais do job

| Estado | Significado |
| --- | --- |
| `RECEIVED` | Job criado a partir de uma submissao aceita |
| `REPROCESSED` | Job criado a partir de um comando manual de reprocessamento |
| `VALIDATED` | Entradas e pre-condicoes do job validadas |
| `STORED` | Documento original confirmado em storage |
| `DEDUPLICATED` | Resultado compativel encontrado e reaproveitado |
| `QUEUED` | Mensagem publicada na fila principal |
| `PROCESSING` | Worker assumiu a tentativa atual |
| `COMPLETED` | Resultado final completo disponivel |
| `PARTIAL` | Resultado final utilizavel, mas incompleto |
| `FAILED` | Nao foi possivel produzir resultado utilizavel |

### Transicoes oficiais

- fluxo padrao: `RECEIVED -> VALIDATED -> STORED -> QUEUED -> PROCESSING -> COMPLETED|PARTIAL|FAILED`
- fluxo deduplicado: `RECEIVED -> VALIDATED -> STORED -> DEDUPLICATED -> COMPLETED|PARTIAL`
- fluxo de reprocessamento: `RECEIVED -> REPROCESSED -> VALIDATED -> STORED -> QUEUED -> PROCESSING -> COMPLETED|PARTIAL|FAILED`

## Agregado `JobAttempt`

Representa uma tentativa concreta de execucao do job.

### Atributos principais

- `attemptId`
- `jobId`
- `attemptNumber`
- `status`
- `pipelineVersion`
- `normalizationVersion`
- `promptVersion`
- `modelVersion`
- `fallbackUsed`
- `fallbackReason`
- `latencyMs`
- `startedAt`
- `finishedAt`
- `errorCode`
- `errorDetails`

### Estados oficiais da tentativa

| Estado | Significado |
| --- | --- |
| `PENDING` | Tentativa criada antes da publicacao em fila |
| `PROCESSING` | Worker iniciou a execucao |
| `COMPLETED` | Tentativa concluida com resultado completo |
| `PARTIAL` | Tentativa concluiu com resultado utilizavel, mas incompleto |
| `FAILED` | Tentativa falhou e pode gerar novo retry |
| `TIMED_OUT` | Tentativa excedeu o budget de tempo |
| `MOVED_TO_DLQ` | Tentativa esgotou retries e foi para DLQ |

## Regras de negocio

- Todo job nasce a partir de `Ingestion` ou de reprocessamento manual.
- A mensagem de fila so existe para jobs que realmente precisam ser processados.
- O primeiro `JobAttempt` e criado pela API com estado `PENDING` para permitir que o `attemptId` faca parte do payload da fila.
- Cada novo retry cria um novo `JobAttempt`.
- Um job pode ter varios attempts, mas apenas um `ProcessingResult` final vinculado ao `jobId`.
- `PARTIAL` significa que existe payload utilizavel, embora incompleto.
- `FAILED` significa ausencia de payload utilizavel apos esgotar as estrategias permitidas.

## Servicos de dominio

- `JobLifecycleService`
- `AttemptLifecycleService`
- `RetryPolicyService`
- `ReprocessingPolicyService`
- `VersionStampService`

## Value objects

- `ProcessingMode`
- `ProcessingPriority`
- `ProcessingStatus`
- `AttemptStatus`
- `VersionStamp`
- `RetryDecision`
- `FailureClassification`

## Portas

### Entrada

- `StartProcessingJobCommand`
- `MarkAttemptAsStartedCommand`
- `CompleteProcessingJobCommand`
- `FailProcessingAttemptCommand`
- `MoveAttemptToDeadLetterCommand`
- `ReprocessJobCommand`

### Saida

- `ProcessingJobRepositoryPort`
- `JobAttemptRepositoryPort`
- `ProcessingResultRepositoryPort`
- `QueuePublisherPort`
- `DeadLetterPort`
- `MetricsPort`
- `TracingPort`
- `ClockPort`
- `UnitOfWorkPort`

## Contrato da fila

Mensagem minima:

```json
{
  "documentId": "doc_123",
  "jobId": "job_123",
  "attemptId": "att_001",
  "requestedMode": "STANDARD",
  "pipelineVersion": "git:9f2ab17",
  "publishedAt": "2026-03-25T10:00:00.000Z"
}
```

Como o `MongoDB` e compartilhado no MVP, o worker consulta o resto do contexto pelo `jobId` e `documentId`.

## Taxonomia inicial de erros

- `VALIDATION_ERROR`
- `AUTHORIZATION_ERROR`
- `NOT_FOUND`
- `TRANSIENT_FAILURE`
- `FATAL_FAILURE`
- `TIMEOUT`
- `DLQ_ERROR`
- `REPROCESSING_ERROR`

## Regras de clean code para este contexto

- maquinas de estado devem viver em objetos ou funcoes puras, nunca espalhadas em `if` anonimos
- retries devem ser decididos por uma politica nomeada, por exemplo `decideRetryAfterAttemptFailure`
- reprocessamento deve usar um caso de uso proprio, por exemplo `createReprocessingJob`
- atualizacao de status e publicacao de eventos devem ficar no mesmo caso de uso e sob `UnitOfWork`

Exemplos de nomes esperados:

- `markJobAsValidated`
- `markJobAsQueued`
- `startPendingAttempt`
- `decideRetryAfterAttemptFailure`
- `moveFailedAttemptToDeadLetter`

## Plano de implementacao orientado a TDD

1. Criar testes unitarios da maquina de estados do `ProcessingJob`.
2. Criar testes unitarios da maquina de estados do `JobAttempt`.
3. Criar testes da `RetryPolicyService` para erro transitorio, falha terminal e timeout.
4. Criar testes de aplicacao do fluxo `queue -> attempt start -> result complete`.
5. Criar testes de aplicacao do fluxo `attempt fail -> retry -> DLQ`.
6. Criar testes de aplicacao do `ReprocessJobCommand`.
7. Criar contract tests do adapter de fila e do adapter de DLQ.

## Cenarios de teste obrigatorios

- publica mensagem apenas quando o job nao for deduplicado
- cria `JobAttempt` inicial com `PENDING`
- marca job como `PROCESSING` quando o worker iniciar o attempt
- conclui job como `PARTIAL` quando o resultado for utilizavel e incompleto
- move tentativa para DLQ apos `3` falhas transitorias
- cria novo job no reprocessamento preservando historico anterior
- nao sobrescreve resultados anteriores ao reprocessar
