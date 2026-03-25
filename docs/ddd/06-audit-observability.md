# DDD: Audit/Observability

## Objetivo

Documentar a trilha operacional que ja existe no repositorio hoje e separar com clareza o que ja esta implementado em auditoria, retry e DLQ do que ainda e backlog de observabilidade.

## Estado atual no codigo

O contexto atual entrega uma base funcional de auditoria e falha operacional, mas ainda nao entrega uma stack completa de observabilidade.

Capacidades realmente implementadas:

- auditoria persistida em `audit_events`
- registro operacional de falhas terminais em `dead_letter_events`
- retry dirigido por politica nomeada (`RetryPolicyService`)
- topologia RabbitMQ com fila principal, filas de retry por TTL e broker DLQ
- persistencia de estados operacionais em `processing_jobs` e `job_attempts`

Capacidades que ainda nao existem no codigo:

- `LoggingPort`
- `MetricsPort`
- `TracingPort`
- `traceId` nos contratos e eventos de auditoria
- correlacao distribuida entre API, fila e worker
- replay manual de `dead_letter_events`
- politica canonica de retencao para `audit_events`, `dead_letter_events`, `processing_results` e `page_artifacts`

## Modelo persistido atual

### `AuditEventRecord`

Campos realmente persistidos:

- `eventId`
- `eventType`
- `actor`
- `metadata`
- `createdAt`

Observacoes:

- nao existe `traceId`
- nao existe `aggregateType`
- nao existe `aggregateId` dedicado; esses IDs entram em `metadata`
- nao existe `redactedPayload`

### `DeadLetterRecord`

Campos realmente persistidos:

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

Observacoes:

- nao existe `replayedAt`
- o replay manual ainda nao foi implementado

## Eventos de auditoria implementados hoje

### `orchestrator-api`

Eventos gravados:

- `DOCUMENT_STORED`
- `DOCUMENT_ACCEPTED`
- `PROCESSING_JOB_QUEUED`
- `COMPATIBLE_RESULT_REUSED`
- `PROCESSING_JOB_QUEUEING_FAILED`
- `RESULT_QUERIED`
- `JOB_REPROCESSING_REQUESTED`

Observacao importante:

- `GET /v1/parsing/jobs/{jobId}` consulta status, mas hoje nao gera auditoria

### `document-processing-worker`

Eventos gravados:

- `PROCESSING_COMPLETED`
- `PROCESSING_RETRY_SCHEDULED`
- `PROCESSING_FAILED`

## Regras operacionais atuais

- Toda submissao aceita gera `DOCUMENT_ACCEPTED`.
- Quando um binario novo e persistido, o sistema gera `DOCUMENT_STORED`.
- Quando o job entra na fila principal, o sistema gera `PROCESSING_JOB_QUEUED`.
- Quando ha reaproveitamento por compatibilidade, o sistema gera `COMPATIBLE_RESULT_REUSED`.
- Consulta de resultado final gera `RESULT_QUERIED`.
- Reprocessamento manual gera `JOB_REPROCESSING_REQUESTED`.
- Conclusao bem-sucedida do worker gera `PROCESSING_COMPLETED`.
- Retry agendado pelo worker gera `PROCESSING_RETRY_SCHEDULED`.
- Falha terminal com persistencia em `dead_letter_events` gera `PROCESSING_FAILED`.

## Retry e DLQ no estado atual

### Politica de retry

O comportamento implementado vem de `MAX_RETRY_ATTEMPTS = 3` e `RETRY_DELAYS_MS = [2000, 4000, 8000]`.

Regra efetiva da politica:

- falha transitoria no `attempt 1` agenda novo attempt com atraso de `2000 ms`
- falha transitoria no `attempt 2` agenda novo attempt com atraso de `4000 ms`
- falha no `attempt 3` nao agenda novo retry e move para DLQ
- `FATAL_FAILURE` nunca gera retry
- `TIMEOUT` move para DLQ quando nao houver mais retry aplicavel

Observacao de implementacao:

- a topologia RabbitMQ cria `<queue>.retry.1`, `<queue>.retry.2` e `<queue>.retry.3`
- a politica atual so agenda retries a partir dos attempts `1` e `2`
- uma falha no `attempt 3` e terminal

### Dois niveis de DLQ

Hoje existem dois conceitos complementares:

1. DLQ de aplicacao
   O worker persiste `DeadLetterRecord` em `dead_letter_events`.

2. DLQ do broker
   A fila principal do RabbitMQ envia mensagens rejeitadas para `<queue>.dlq`.

Fluxo terminal atual:

- o worker classifica a falha
- decide retry ou DLQ via `RetryPolicyService`
- quando a decisao e terminal, persiste `dead_letter_events` e audita `PROCESSING_FAILED`
- em seguida a mensagem e rejeitada pelo listener com `nack(requeue = false)`, permitindo o roteamento para a DLQ do broker

## Fronteira do contexto hoje

### `orchestrator-api`

Responsabilidades implementadas:

- auditar submissao
- auditar enfileiramento
- auditar reaproveitamento de resultado compativel
- auditar consulta de resultado
- auditar solicitacao de reprocessamento

### `document-processing-worker`

Responsabilidades implementadas:

- iniciar tentativa
- concluir tentativa com auditoria de sucesso
- classificar falhas
- agendar retry
- persistir DLQ de aplicacao
- auditar falha terminal

## Dados sensiveis no estado atual

### O que o contexto ja protege

- `AuditEventRecord` grava metadados operacionais simples, nao o payload final completo
- `SensitiveDataMaskingService` mascara texto antes de enviar fallback para `LLM` externo

### O que ainda exige cuidado arquitetural

- nao existe um `RedactionPolicyService` dedicado para auditoria
- `page_artifacts` podem carregar `rawText`, `rawPayload`, `promptText` e `responseText` em `metadata`
- a politica de mascaramento atual cobre envio ao `LLM`, nao todo e qualquer registro tecnico interno
- nao existe stack de logs estruturados no repositorio para aplicar redacao centralizada

## Retencao no estado atual

A unica politica de retencao explicitamente implementada no codigo e a do documento original:

- `RetentionPolicyService.calculateOriginalRetentionUntil` define `30 dias` para o binario canonico

Ainda nao existe politica implementada para:

- `audit_events`
- `dead_letter_events`
- `processing_results`
- `page_artifacts`

## Portas e componentes reais do contexto

### Portas implementadas

- `AuditPort`
- `DeadLetterRepositoryPort`
- `JobPublisherPort`
- `ProcessingJobRepositoryPort`
- `JobAttemptRepositoryPort`
- `ProcessingResultRepositoryPort`
- `ClockPort`
- `UnitOfWorkPort`

### Componentes que materializam o comportamento atual

- `SubmitDocumentUseCase`
- `GetProcessingResultUseCase`
- `ReprocessDocumentUseCase`
- `ProcessJobMessageUseCase`
- `RetryPolicyService`
- `RabbitMqJobPublisherAdapter`
- `RabbitMqProcessingJobListener`

## Gaps explicitos para a proxima fase

- introduzir `traceId` e correlacao ponta a ponta
- criar telemetria explicita para latencia, throughput e taxa de falha
- introduzir logging estruturado com redacao centralizada
- definir politica de retencao para eventos, artefatos e DLQ
- implementar replay manual de `dead_letter_events`
- decidir se consulta de status tambem deve gerar auditoria

## Criterio de alinhamento com o repositorio

Este documento estara coerente com o codigo enquanto todos os itens abaixo forem verdadeiros:

- auditoria for representada por `AuditEventRecord` simples
- observabilidade forte ainda nao estiver implementada via logs, metricas e traces dedicados
- retry continuar governado por `RetryPolicyService`
- falha terminal continuar produzindo `dead_letter_events` e rejeicao para a DLQ do broker
- a unica retencao explicita implementada continuar sendo a do documento original
