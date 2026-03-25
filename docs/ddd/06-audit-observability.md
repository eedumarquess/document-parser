# DDD: Audit/Observability

## Objetivo

Garantir rastreabilidade operacional e auditável por documento, job, tentativa e resultado, sem expor conteúdo sensível em logs.

## Responsabilidades

- Gerar logs estruturados
- Emitir métricas e traces
- Registrar eventos auditáveis de acesso e operação
- Controlar DLQ e replay manual
- Aplicar mascaramento e redaction

## Agregados principais

### `AuditEvent`

Registro auditável de ação relevante no sistema.

### `DeadLetterRecord`

Registro operacional de mensagens não processadas.

## Regras de negócio

- Logs não devem conter payload textual integral do documento
- O sistema deve registrar `documentId`, `jobId`, `hash`, `status`, `engine`, `latency`, `retryCount` e `pipelineVersion`
- Toda leitura sensível deve gerar trilha de auditoria
- Mensagens em DLQ precisam ser diagnosticáveis e passíveis de replay manual

## Value objects

- `TraceContext`
- `AuditActor`
- `RedactedPayload`
- `DeadLetterReason`
- `MetricTagSet`

## Serviços de domínio

- `AuditTrailService`
- `TelemetryService`
- `DeadLetterService`
- `RedactionPolicyService`

## Repositórios

- `AuditEventRepository`
- `DeadLetterRepository`

## Eventos de domínio

- `DocumentSubmittedLogged`
- `ProcessingTelemetryCaptured`
- `SensitiveAccessAudited`
- `DeadLetterRegistered`
- `DeadLetterReplayed`

## Portas

### Entrada

- `RegisterAuditEventCommand`
- `RegisterDeadLetterCommand`

### Saída

- `LoggingPort`
- `MetricsPort`
- `TracingPort`
- `AuditRepositoryPort`
- `DeadLetterRepositoryPort`

## Observabilidade mínima do MVP

- métricas por documento e por etapa
- logs estruturados por transação
- traces distribuídos entre API, fila e worker
- integração com `Datadog` ou equivalente
