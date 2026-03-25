# DDD: Audit/Observability

## Objetivo

Garantir rastreabilidade operacional e auditavel sem expor conteudo sensivel em logs, traces ou eventos.

## Decisoes fechadas do MVP

- auditoria obrigatoria para submissao de documento
- auditoria obrigatoria para consulta de resultado
- auditoria obrigatoria para reprocessamento
- auditoria obrigatoria para falhas criticas
- logs nao podem carregar o texto integral do documento
- metricas, logs estruturados e traces existem desde a primeira versao
- retry exponencial com no maximo `3` tentativas
- DLQ obrigatoria para falhas que excederem o retry permitido

## Politica de retencao do MVP

| Categoria | Retencao |
| --- | --- |
| original e artefatos derivados | `30 dias` |
| OCR bruto e resultado final | `90 dias` |
| eventos de auditoria e DLQ | `180 dias` |

## Agregados principais

### `AuditEvent`

Registro auditavel de uma acao relevante.

Campos minimos:

- `eventId`
- `eventType`
- `aggregateType`
- `aggregateId`
- `actor`
- `traceId`
- `metadata`
- `redactedPayload`
- `createdAt`

### `DeadLetterRecord`

Registro operacional de mensagem nao processada.

Campos minimos:

- `dlqEventId`
- `jobId`
- `attemptId`
- `queueName`
- `reasonCode`
- `reasonMessage`
- `retryCount`
- `payloadSnapshot`
- `firstSeenAt`
- `lastSeenAt`
- `replayedAt`

## Regras de negocio

- logs devem priorizar IDs, status, versoes e motivos de falha
- qualquer payload auditado precisa passar por redacao antes de ser persistido
- consultas sensiveis precisam gerar trilha de auditoria
- DLQ precisa guardar contexto suficiente para replay manual
- traces precisam correlacionar `documentId`, `jobId` e `attemptId`

## Telemetria minima por documento

- `documentId`
- `jobId`
- `attemptId` quando existir
- `hash`
- `status`
- `requestedMode`
- `pipelineVersion`
- `outputVersion`
- `latencyMs`
- `fallbackUsed`
- `retryCount`
- `errorCode`

## Servicos de dominio

- `AuditTrailService`
- `TelemetryService`
- `DeadLetterService`
- `RedactionPolicyService`
- `RetentionPolicyService`

## Portas

### Entrada

- `RegisterAuditEventCommand`
- `RegisterDeadLetterCommand`
- `ReplayDeadLetterCommand`

### Saida

- `LoggingPort`
- `MetricsPort`
- `TracingPort`
- `AuditRepositoryPort`
- `DeadLetterRepositoryPort`
- `ClockPort`

## Operacoes que geram auditoria no MVP

- `POST /v1/parsing/jobs`
- `GET /v1/parsing/jobs/{jobId}/result`
- `POST /v1/parsing/jobs/{jobId}/reprocess`
- falha terminal do processamento
- envio de mensagem para DLQ

## Regras de clean code para este contexto

- toda redacao deve ficar em funcao nomeada, por exemplo `redactSensitiveFieldsFromAuditPayload`
- eventos de auditoria devem ser montados por `factory` ou `assembler` nomeado
- replay de DLQ deve passar por caso de uso explicito, por exemplo `requeueDeadLetterAttempt`
- adapters de log nao podem reinventar a politica de mascaramento

## Plano de implementacao orientado a TDD

1. Criar testes do `RedactionPolicyService`.
2. Criar testes do `AuditTrailService` para submissao, leitura de resultado e reprocessamento.
3. Criar testes do `DeadLetterService` para registro e replay manual.
4. Criar contract tests dos adapters de log, metricas e traces.
5. Criar testes E2E cobrindo correlacao de `traceId` entre API, fila e worker.

## Cenarios de teste obrigatorios

- nao grava texto integral do documento em log
- grava auditoria ao criar job
- grava auditoria ao consultar resultado
- grava auditoria ao reprocessar
- registra mensagem na DLQ apos esgotar retries
- permite replay manual da DLQ com novo `attemptId`
