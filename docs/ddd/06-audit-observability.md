# DDD: Audit/Observability

## Objetivo

Documentar a trilha operacional realmente implementada no repositorio hoje: auditoria, redacao, correlacao por `traceId`, retry, DLQ, telemetria consultavel por job e observabilidade via ports com backend local ou `OTLP/HTTP`.

## Estado atual no codigo

O contexto atual entrega auditoria, retencao, redacao e uma stack de observabilidade vendor-agnostic com persistencia consultavel em Mongo.

Capacidades realmente implementadas:

- auditoria persistida em `audit_events`
- registro operacional de falhas terminais em `dead_letter_events`
- telemetria persistida em `telemetry_events`
- retry dirigido por politica nomeada (`RetryPolicyService`)
- topologia RabbitMQ com fila principal, filas de retry por TTL e broker DLQ
- persistencia de estados operacionais em `processing_jobs` e `job_attempts`
- `LoggingPort`
- `MetricsPort`
- `TracingPort`
- `traceId` em contratos HTTP, publicacao de fila, auditoria e DLQ
- correlacao consistente por `jobId`, `documentId`, `attemptId` e `traceId` em logs, metricas e spans
- correlacao entre `orchestrator-api`, `RabbitMQ` e `document-processing-worker`
- replay manual de `dead_letter_events`
- endpoint JSON `GET /v1/ops/jobs/{jobId}/context` para leitura operacional agregada
- painel HTML `GET /ops/jobs/{jobId}` para inspecao manual
- politica canonica de retencao para `audit_events`, `dead_letter_events`, `processing_results`, `page_artifacts` e `telemetry_events`
- redacao centralizada por contexto com `RedactionPolicyService`
- backend opcional de export via `OTLP/HTTP`, mantendo adapters locais como fallback

## Modelo persistido atual

### `AuditEventRecord`

Campos realmente persistidos:

- `eventId`
- `eventType`
- `aggregateType`
- `aggregateId`
- `traceId`
- `actor`
- `metadata`
- `redactedPayload`
- `createdAt`
- `retentionUntil`

### `DeadLetterRecord`

Campos realmente persistidos:

- `dlqEventId`
- `jobId`
- `attemptId`
- `traceId`
- `queueName`
- `reasonCode`
- `reasonMessage`
- `retryCount`
- `payloadSnapshot`
- `firstSeenAt`
- `lastSeenAt`
- `replayedAt`
- `retentionUntil`

### `TelemetryEventRecord`

Campos comuns realmente persistidos:

- `telemetryEventId`
- `kind`
- `serviceName`
- `traceId`
- `jobId`
- `documentId`
- `attemptId`
- `operation`
- `occurredAt`
- `retentionUntil`

Payload por tipo:

- `log`: `level`, `message`, `data`
- `metric`: `metricName`, `metricType`, `value`, `unit`, `tags`
- `span`: `spanName`, `attributes`, `startedAt`, `endedAt`, `status`, `errorMessage`

## Eventos de auditoria implementados hoje

### `orchestrator-api`

Eventos gravados:

- `DOCUMENT_STORED`
- `DOCUMENT_ACCEPTED`
- `PROCESSING_JOB_QUEUED`
- `COMPATIBLE_RESULT_REUSED`
- `PROCESSING_JOB_QUEUEING_FAILED`
- `JOB_STATUS_QUERIED`
- `RESULT_QUERIED`
- `JOB_REPROCESSING_REQUESTED`
- `DEAD_LETTER_REPLAY_REQUESTED`
- `DEAD_LETTER_REPLAY_COMPLETED`
- `JOB_OPERATIONAL_CONTEXT_QUERIED`

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
- Consulta de status gera `JOB_STATUS_QUERIED`.
- Consulta de resultado final gera `RESULT_QUERIED`.
- Consulta do contexto operacional gera `JOB_OPERATIONAL_CONTEXT_QUERIED`.
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

### Retry intra-provider no fallback LLM remoto

Os adapters remotos de LLM aplicam um hardening proprio, independente do retry de job:

- timeout por request com `AbortController`
- concorrencia limitada por `LLM_MAX_CONCURRENCY`
- retry com backoff exponencial para falhas transitorias e timeout
- resposta degradada por target via `LLM_FALLBACK_UNAVAILABLE`, sem derrubar o job inteiro

Configuracao suportada:

- `LLM_REQUEST_TIMEOUT_MS`
- `LLM_MAX_CONCURRENCY`
- `LLM_MAX_RETRIES`
- `LLM_RETRY_BASE_DELAY_MS`

## Painel operacional por job

O read model operacional atual e montado pela `orchestrator-api` por `jobId`.

Contratos expostos:

- `GET /v1/ops/jobs/{jobId}/context`
- `GET /ops/jobs/{jobId}`

Dados agregados hoje:

- `summary`
- `attempts`
- `result`
- `auditEvents`
- `deadLetters`
- `artifacts`
- `traceIds`
- `timeline`
- `telemetry`

Fontes consultadas:

- `processing_jobs`
- `job_attempts`
- `processing_results`
- `audit_events`
- `dead_letter_events`
- `page_artifacts`
- `telemetry_events`

### Redacao no read path

As previas operacionais de artefatos sao geradas no momento da leitura, sem alterar o schema persistido.

Regras efetivas:

- `OCR_JSON`, `MASKED_TEXT`, `LLM_PROMPT` e `LLM_RESPONSE` geram `previewText` truncado e semanticamente mascarado
- `rawText`, `rawPayload`, `promptText` e `responseText` nao saem no JSON nem no HTML
- artefatos binarios como `RENDERED_IMAGE` ficam restritos a metadados

## Fronteira do contexto hoje

### `orchestrator-api`

Responsabilidades implementadas:

- auditar submissao
- auditar enfileiramento
- auditar reaproveitamento de resultado compativel
- auditar consulta de status
- auditar consulta de resultado
- auditar consulta do contexto operacional
- auditar solicitacao de reprocessamento
- replay manual de DLQ
- servir o painel operacional por `jobId`

### `document-processing-worker`

Responsabilidades implementadas:

- iniciar tentativa
- concluir tentativa com auditoria de sucesso
- classificar falhas
- agendar retry
- persistir DLQ de aplicacao
- auditar falha terminal
- emitir spans de stage para `context_load`, `attempt_start`, `extraction`, `success_persist` e `failure_recovery`
- emitir spans e metricas para `page_extraction`, `fallback_resolution` e `outcome_assembly`

## Dados sensiveis no estado atual

### O que o contexto ja protege

- `AuditEventRecord` grava `metadata` sanitizado e `redactedPayload`
- `SensitiveDataMaskingService` mascara texto antes de enviar fallback para `LLM` externo
- `RedactionPolicyService` redige por contexto (`audit`, `log`, `dead_letter`, `artifact`)
- a redacao tambem cobre deteccao semantica para `email`, `phone`, `cpf`, `cnpj`, `cep` e tokens longos
- chaves tecnicamente sensiveis como `payload`, `rawText`, `rawPayload`, `promptText`, `responseText`, `buffer` e equivalentes sao sempre colapsadas

### Regras operacionais de redacao

- `metadata` persistido deve privilegiar ids, enums, contagens, versoes e timestamps
- texto livre e snapshots de erro devem ser saneados antes de log, auditoria ou DLQ
- artefatos e payloads brutos continuam separados do canal de auditoria
- o painel operacional nunca deve devolver previews com PII, tokens ou blobs crus

### O que ainda exige cuidado arquitetural

- `page_artifacts` podem carregar `rawText`, `rawPayload`, `promptText` e `responseText` em `metadata`
- a exportacao `OTLP/HTTP` atual e simples e nao faz batching, persistencia local ou health-check do collector
- dashboards, alertas e SLOs ainda nao fazem parte do repositorio

## Retencao no estado atual

O `RetentionPolicyService` implementa hoje:

- `30 dias` para documento original
- `180 dias` para `audit_events`
- `180 dias` para `dead_letter_events`
- `90 dias` para `processing_results`
- `90 dias` para `page_artifacts` do tipo `OCR_JSON`
- `30 dias` para os demais `page_artifacts`
- `30 dias` para `telemetry_events`

Os adapters Mongo criam indices TTL para as colecoes com `retentionUntil`.

## Portas e componentes reais do contexto

### Portas implementadas

- `AuditPort`
- `DeadLetterRepositoryPort`
- `PageArtifactRepositoryPort`
- `TelemetryEventRepositoryPort`
- `JobPublisherPort`
- `ProcessingJobRepositoryPort`
- `JobAttemptRepositoryPort`
- `ProcessingResultRepositoryPort`
- `LoggingPort`
- `MetricsPort`
- `TracingPort`
- `ClockPort`
- `UnitOfWorkPort`

### Componentes que materializam o comportamento atual

- `SubmitDocumentUseCase`
- `GetJobStatusUseCase`
- `GetProcessingResultUseCase`
- `GetJobOperationalContextUseCase`
- `ReprocessDocumentUseCase`
- `ProcessJobMessageUseCase`
- `RetryPolicyService`
- `RabbitMqJobPublisherAdapter`
- `RabbitMqProcessingJobListener`
- `ReplayDeadLetterUseCase`
- `ArtifactPreviewService`
- `RedactionPolicyService`
- `RetentionPolicyService`
- adapters locais de observabilidade
- adapters `OTLP/HTTP` de observabilidade
- adapters fan-out de observabilidade com persistencia consultavel em `telemetry_events`

## Observabilidade em runtime

Configuracao atual:

- `OBSERVABILITY_MODE=local` usa adapters em memoria ou console e preserva o comportamento local
- `OBSERVABILITY_MODE=otlp` ativa exportacao `OTLP/HTTP`
- o runtime `real` faz fan-out para o exporter configurado e para `telemetry_events`
- `OTEL_EXPORTER_OTLP_ENDPOINT` define o collector
- `OTEL_EXPORTER_OTLP_HEADERS` injeta headers extras
- `OTEL_SERVICE_NAME` sobrescreve o nome do servico

Comportamento de fallback:

- configuracao ausente ou invalida para `otlp` cai de volta nos adapters locais
- falhas de export nao derrubam os casos de uso
- falhas ao persistir o read model de telemetria nao devem derrubar a operacao principal

## Suites reais de infraestrutura

As suites de contratos reais usam `testcontainers` e ficam protegidas por `RUN_REAL_INFRA_TESTS=true`.

Cobertura relevante:

- `MongoDB` com indices operacionais e TTL
- `MinIO` para binario original e artefatos
- `RabbitMQ` com fila principal, retry e broker DLQ
- persistencia e consulta de `telemetry_events`
- fluxo ponta a ponta do worker, incluindo sucesso, retry e falha terminal

## Gaps explicitos remanescentes

- collector `OTLP` ainda sem batching e retry dedicado do exporter
- dashboards, alertas e SLOs ainda nao versionados no repositorio
- o painel atual e orientado a `jobId` e nao oferece listagem global de jobs
- propagacao de contexto distribuido usa `traceId` proprio, nao uma stack OpenTelemetry completa de headers entre todos os hops

## Criterio de alinhamento com o repositorio

Este documento estara coerente com o codigo enquanto todos os itens abaixo forem verdadeiros:

- auditoria for representada por `AuditEventRecord` com `aggregateType`, `aggregateId`, `traceId`, `metadata`, `redactedPayload` e `retentionUntil`
- observabilidade continuar exposta por `LoggingPort`, `MetricsPort` e `TracingPort`
- a telemetria consultavel continuar persistida em `TelemetryEventRecord`
- o runtime aceitar `local` e `otlp` com fallback automatico para local
- retry continuar governado por `RetryPolicyService`
- os adapters remotos de LLM continuarem com timeout, concorrencia controlada e retry proprio
- falha terminal continuar produzindo `dead_letter_events` e rejeicao para a DLQ do broker
- a retencao continuar centralizada em `RetentionPolicyService`
