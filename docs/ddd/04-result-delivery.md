# DDD: Result Delivery

## Objetivo

Expor o estado do processamento e a saída versionada sem acoplar o consumidor à complexidade interna da pipeline.

## Responsabilidades

- Fornecer consulta de status por job
- Expor resultado final enriquecido
- Suportar reprocessamento controlado
- Entregar erros funcionais claros
- Aplicar autorização e auditoria de acesso

## Agregados principais

### `ProcessingResult`

Saída versionada do processamento de um documento.

#### Atributos principais

- `resultId`
- `jobId`
- `documentId`
- `status`
- `outputVersion`
- `engineUsed`
- `confidenceScore`
- `normalizedText`
- `fields`
- `checkboxes`
- `handwrittenSegments`
- `warnings`

### `ResultAccess`

Objeto de política para validar quem pode consultar, baixar ou reprocessar.

## Regras de negócio

- O endpoint de resultado não deve expor artefatos internos sem autorização explícita
- Reprocessamento deve preservar histórico anterior
- Erros funcionais precisam ter código estável, mensagem clara e contexto mínimo
- O resultado final é sempre associado a versões técnicas relevantes

## Value objects

- `OutputVersion`
- `ResultStatus`
- `ErrorCode`
- `AccessDecision`

## Serviços de domínio

- `ResultAssemblerService`
- `ResultExposurePolicy`
- `ReprocessAuthorizationService`
- `ErrorContractService`

## Repositórios

- `ProcessingResultRepository`
- `ProcessingJobRepository`
- `AuditEventRepository`

## Eventos de domínio

- `ResultPublished`
- `ResultQueried`
- `ResultDownloadRequested`
- `JobReprocessingRequested`

## Portas

### Entrada

- `GetJobStatusQuery`
- `GetProcessingResultQuery`
- `ReprocessDocumentCommand`

### Saída

- `ReadModelPort`
- `AuthorizationPort`
- `AuditPort`

## Contrato externo mínimo

- `jobId`
- `documentId`
- `status`
- `hash`
- `pages`
- `engine`
- `latency`
- `warnings`
- `confidence`
- `outputVersion`
- `payload`
