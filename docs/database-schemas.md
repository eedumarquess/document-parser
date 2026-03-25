# Database Schemas

Modelagem lógica inicial para implementação futura em MongoDB. Os nomes abaixo representam coleções, mas foram organizados em formato de tabela para facilitar desenho, revisão e futura tradução para ODM ou migrations.

## `documents`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do documento |
| `documentId` | `string` | Sim | ID público do documento |
| `hash` | `string` | Sim | Hash SHA-256 do binário original |
| `originalFileName` | `string` | Sim | Nome original do arquivo enviado |
| `mimeType` | `string` | Sim | MIME validado na ingestão |
| `fileSizeBytes` | `number` | Sim | Tamanho bruto do arquivo |
| `pageCount` | `number` | Não | Quantidade de páginas identificada |
| `sourceType` | `string` | Sim | Origem do documento, ex.: `MULTIPART` |
| `storageBucket` | `string` | Sim | Bucket privado no MinIO |
| `storageObjectKey` | `string` | Sim | Chave do objeto original |
| `storageVersionId` | `string` | Não | Versão do objeto no storage |
| `status` | `string` | Sim | Estado atual do documento |
| `deduplicationKey` | `string` | Sim | Hash combinado com versão de pipeline compatível |
| `lastAcceptedJobId` | `string` | Não | Último job aceito para o documento |
| `retentionUntil` | `date` | Sim | Data limite de retenção |
| `createdAt` | `date` | Sim | Data de criação |
| `updatedAt` | `date` | Sim | Data de atualização |

Índices sugeridos: `documentId` único, `hash`, `deduplicationKey`, `status`, `createdAt`.

## `processing_jobs`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do job |
| `jobId` | `string` | Sim | ID público do job |
| `documentId` | `string` | Sim | Referência ao documento |
| `requestedMode` | `string` | Sim | Modo de processamento solicitado |
| `status` | `string` | Sim | Estado do job |
| `priority` | `string` | Sim | Prioridade lógica do job |
| `queueName` | `string` | Sim | Fila de processamento |
| `reusedResult` | `boolean` | Sim | Indica reaproveitamento sem reprocessamento |
| `forceReprocess` | `boolean` | Sim | Indica bypass da idempotência |
| `reprocessOfJobId` | `string` | Não | Job anterior reprocessado |
| `requestedBy` | `object` | Não | Identidade resumida do solicitante |
| `errorCode` | `string` | Não | Código de erro padronizado |
| `errorMessage` | `string` | Não | Mensagem funcional ou técnica |
| `warnings` | `array<string>` | Não | Warnings de execução |
| `acceptedAt` | `date` | Sim | Momento de aceite da requisição |
| `queuedAt` | `date` | Não | Momento de publicação em fila |
| `startedAt` | `date` | Não | Momento de início de processamento |
| `finishedAt` | `date` | Não | Momento final do job |
| `createdAt` | `date` | Sim | Data de criação |
| `updatedAt` | `date` | Sim | Data de atualização |

Índices sugeridos: `jobId` único, `documentId`, `status`, `requestedMode`, `acceptedAt`.

## `job_attempts`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno da tentativa |
| `attemptId` | `string` | Sim | ID público da tentativa |
| `jobId` | `string` | Sim | Job relacionado |
| `attemptNumber` | `number` | Sim | Sequência da tentativa |
| `workerId` | `string` | Não | Worker responsável |
| `enginePlan` | `array<object>` | Sim | Ordem de engines previstas |
| `fallbackUsed` | `boolean` | Sim | Indica uso de fallback |
| `fallbackReason` | `string` | Não | Motivo da troca de engine |
| `pipelineVersion` | `string` | Sim | Versão da pipeline |
| `promptVersion` | `string` | Não | Versão do prompt usado |
| `modelVersion` | `string` | Não | Versão do modelo usado |
| `normalizationVersion` | `string` | Sim | Versão das regras de normalização |
| `startedAt` | `date` | Sim | Início da tentativa |
| `finishedAt` | `date` | Não | Fim da tentativa |
| `latencyMs` | `number` | Não | Latência fim a fim da tentativa |
| `status` | `string` | Sim | Estado da tentativa |
| `errorCode` | `string` | Não | Código de falha da tentativa |
| `errorDetails` | `object` | Não | Detalhes técnicos de falha |
| `createdAt` | `date` | Sim | Data de criação |

Índices sugeridos: `attemptId` único, `jobId`, `status`, `pipelineVersion`.

## `processing_results`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do resultado |
| `resultId` | `string` | Sim | ID público do resultado |
| `jobId` | `string` | Sim | Job que gerou o resultado |
| `documentId` | `string` | Sim | Documento processado |
| `status` | `string` | Sim | Resultado final: `SUCCESS`, `PARTIAL`, `FAILED` |
| `outputVersion` | `string` | Sim | Versão do contrato de saída |
| `apiVersion` | `string` | Sim | Versão da API |
| `pipelineVersion` | `string` | Sim | Versão da pipeline |
| `promptVersion` | `string` | Não | Versão do prompt |
| `modelVersion` | `string` | Não | Versão do modelo |
| `engineUsed` | `string` | Sim | Engine principal vencedora |
| `confidenceScore` | `number` | Sim | Score global do documento |
| `totalLatencyMs` | `number` | Sim | Latência fim a fim |
| `warnings` | `array<string>` | Não | Warnings funcionais |
| `normalizedText` | `string` | Não | Texto consolidado normalizado |
| `fields` | `array<object>` | Não | Campos estruturados extraídos |
| `checkboxes` | `array<object>` | Não | Marcações de checkbox |
| `handwrittenSegments` | `array<object>` | Não | Trechos manuscritos transcritos |
| `illegibleSegments` | `array<object>` | Não | Trechos marcados como ilegíveis |
| `pageSummaries` | `array<object>` | Não | Resumo por página para debug |
| `storageSnapshot` | `object` | Não | Referência para artefatos relevantes |
| `createdAt` | `date` | Sim | Data de criação |
| `updatedAt` | `date` | Sim | Data de atualização |

Índices sugeridos: `resultId` único, `jobId`, `documentId`, `status`, `pipelineVersion`, `createdAt`.

## `page_artifacts`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do artefato |
| `artifactId` | `string` | Sim | ID público do artefato |
| `documentId` | `string` | Sim | Documento relacionado |
| `jobId` | `string` | Sim | Job relacionado |
| `pageNumber` | `number` | Sim | Página de origem |
| `artifactType` | `string` | Sim | Ex.: `RENDERED_IMAGE`, `OCR_JSON`, `MASKED_TEXT` |
| `storageBucket` | `string` | Sim | Bucket do artefato |
| `storageObjectKey` | `string` | Sim | Chave do objeto no MinIO |
| `storageVersionId` | `string` | Não | Versão do objeto |
| `mimeType` | `string` | Sim | MIME do artefato |
| `checksum` | `string` | Não | Hash do artefato |
| `metadata` | `object` | Não | Metadados livres por tipo |
| `createdAt` | `date` | Sim | Data de criação |

Índices sugeridos: `artifactId` único, `documentId`, `jobId`, `pageNumber`, `artifactType`.

## `handwritten_segments`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do segmento |
| `segmentId` | `string` | Sim | ID público do segmento |
| `documentId` | `string` | Sim | Documento relacionado |
| `jobId` | `string` | Sim | Job que detectou o segmento |
| `pageNumber` | `number` | Sim | Página de origem |
| `boundingBox` | `object` | Não | Região aproximada do manuscrito |
| `transcription` | `string` | Não | Texto manuscrito reconhecido |
| `confidenceScore` | `number` | Sim | Confiança do segmento |
| `isIllegible` | `boolean` | Sim | Indica retorno como `[ilegível]` |
| `reviewStatus` | `string` | Sim | Status para futura revisão humana |
| `artifactId` | `string` | Não | Referência ao artefato da página |
| `createdAt` | `date` | Sim | Data de criação |

Índices sugeridos: `segmentId` único, `documentId`, `jobId`, `pageNumber`, `isIllegible`.

## `template_definitions`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do template |
| `templateId` | `string` | Sim | ID público do template |
| `name` | `string` | Sim | Nome funcional do template |
| `documentDomain` | `string` | Sim | Domínio documental associado |
| `version` | `string` | Sim | Versão do template |
| `status` | `string` | Sim | Estado do template |
| `matchingRules` | `array<object>` | Sim | Regras de classificação |
| `fieldDefinitions` | `array<object>` | Sim | Campos esperados |
| `checkboxDefinitions` | `array<object>` | Não | Checkboxes esperados |
| `activationDate` | `date` | Não | Início de vigência |
| `deprecationDate` | `date` | Não | Fim de vigência |
| `createdAt` | `date` | Sim | Data de criação |
| `updatedAt` | `date` | Sim | Data de atualização |

Índices sugeridos: `templateId` único, `documentDomain`, `name`, `version`, `status`.

## `audit_events`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do evento |
| `eventId` | `string` | Sim | ID público do evento |
| `eventType` | `string` | Sim | Tipo do evento auditável |
| `aggregateType` | `string` | Sim | Tipo do agregado afetado |
| `aggregateId` | `string` | Sim | ID do agregado afetado |
| `actor` | `object` | Não | Quem executou a ação |
| `traceId` | `string` | Não | Identificador de rastreio |
| `metadata` | `object` | Não | Metadados operacionais |
| `redactedPayload` | `object` | Não | Payload auditável sem PII em claro |
| `createdAt` | `date` | Sim | Momento do evento |

Índices sugeridos: `eventId` único, `eventType`, `aggregateType`, `aggregateId`, `createdAt`.

## `dead_letter_events`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do evento DLQ |
| `dlqEventId` | `string` | Sim | ID público do evento |
| `jobId` | `string` | Não | Job relacionado |
| `queueName` | `string` | Sim | Fila de origem |
| `routingKey` | `string` | Não | Routing key da mensagem |
| `messageId` | `string` | Não | ID da mensagem original |
| `reasonCode` | `string` | Sim | Código padronizado do motivo |
| `reasonMessage` | `string` | Sim | Resumo do erro |
| `retryCount` | `number` | Sim | Quantidade de tentativas anteriores |
| `payloadSnapshot` | `object` | Não | Payload sanitizado da mensagem |
| `firstSeenAt` | `date` | Sim | Primeira ocorrência |
| `lastSeenAt` | `date` | Sim | Última ocorrência |
| `replayedAt` | `date` | Não | Momento de replay manual |
| `resolvedAt` | `date` | Não | Momento de encerramento |

Índices sugeridos: `dlqEventId` único, `jobId`, `queueName`, `reasonCode`, `lastSeenAt`.
