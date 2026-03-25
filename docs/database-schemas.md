# Database Schemas

Modelagem logica inicial para implementacao futura em MongoDB. Os nomes abaixo representam colecoes, mas foram organizados em formato de tabela para facilitar desenho, revisao e futura traducao para ODM ou migrations.

## `documents`

| Campo | Tipo | Obrigatorio | Descricao |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do documento |
| `documentId` | `string` | Sim | ID publico do documento |
| `hash` | `string` | Sim | Hash SHA-256 do binario original |
| `originalFileName` | `string` | Sim | Nome original do arquivo enviado |
| `mimeType` | `string` | Sim | MIME validado na ingestao |
| `fileSizeBytes` | `number` | Sim | Tamanho bruto do arquivo |
| `pageCount` | `number` | Sim | Quantidade de paginas identificada |
| `sourceType` | `string` | Sim | Origem do documento, ex.: `MULTIPART` |
| `storageBucket` | `string` | Sim | Bucket privado no storage |
| `storageObjectKey` | `string` | Sim | Chave do objeto original |
| `storageVersionId` | `string` | Nao | Versao do objeto no storage |
| `retentionUntil` | `date` | Sim | Data limite de retencao |
| `createdAt` | `date` | Sim | Data de criacao |
| `updatedAt` | `date` | Sim | Data de atualizacao |

Indices sugeridos: `documentId` unico, `hash`, `createdAt`.

## `processing_jobs`

| Campo | Tipo | Obrigatorio | Descricao |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do job |
| `jobId` | `string` | Sim | ID publico do job |
| `documentId` | `string` | Sim | Referencia ao documento |
| `requestedMode` | `string` | Sim | Modo de processamento solicitado |
| `status` | `string` | Sim | Estado do job |
| `priority` | `string` | Sim | Prioridade logica do job |
| `queueName` | `string` | Sim | Fila de processamento |
| `reusedResult` | `boolean` | Sim | Indica reaproveitamento sem reprocessamento |
| `forceReprocess` | `boolean` | Sim | Indica bypass da idempotencia |
| `pipelineVersion` | `string` | Sim | Versao planejada da pipeline para o job |
| `outputVersion` | `string` | Sim | Versao planejada do contrato de saida |
| `sourceJobId` | `string` | Nao | Job original quando houve reaproveitamento |
| `sourceResultId` | `string` | Nao | Resultado original quando houve reaproveitamento |
| `reprocessOfJobId` | `string` | Nao | Job anterior reprocessado |
| `requestedBy` | `object` | Sim | Identidade resumida do solicitante |
| `errorCode` | `string` | Nao | Codigo de erro padronizado |
| `errorMessage` | `string` | Nao | Mensagem funcional ou tecnica |
| `warnings` | `array<string>` | Nao | Warnings de execucao |
| `acceptedAt` | `date` | Sim | Momento de aceite da requisicao |
| `queuedAt` | `date` | Nao | Momento de publicacao em fila |
| `startedAt` | `date` | Nao | Momento de inicio de processamento |
| `finishedAt` | `date` | Nao | Momento final do job |
| `createdAt` | `date` | Sim | Data de criacao |
| `updatedAt` | `date` | Sim | Data de atualizacao |

Indices sugeridos: `jobId` unico, `documentId`, `status`, `requestedMode`, `pipelineVersion`, `acceptedAt`.

## `job_attempts`

| Campo | Tipo | Obrigatorio | Descricao |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno da tentativa |
| `attemptId` | `string` | Sim | ID publico da tentativa |
| `jobId` | `string` | Sim | Job relacionado |
| `attemptNumber` | `number` | Sim | Sequencia da tentativa |
| `pipelineVersion` | `string` | Sim | Versao da pipeline |
| `fallbackUsed` | `boolean` | Sim | Indica uso de fallback |
| `promptVersion` | `string` | Nao | Versao do prompt usado |
| `modelVersion` | `string` | Nao | Versao do modelo usado |
| `normalizationVersion` | `string` | Nao | Versao das regras de normalizacao |
| `startedAt` | `date` | Nao | Inicio da tentativa |
| `finishedAt` | `date` | Nao | Fim da tentativa |
| `latencyMs` | `number` | Nao | Latencia fim a fim da tentativa |
| `status` | `string` | Sim | Estado da tentativa |
| `errorCode` | `string` | Nao | Codigo de falha da tentativa |
| `errorDetails` | `object` | Nao | Detalhes tecnicos de falha |
| `createdAt` | `date` | Sim | Data de criacao |

Indices sugeridos: `attemptId` unico, `jobId`, `status`, `pipelineVersion`.

## `processing_results`

| Campo | Tipo | Obrigatorio | Descricao |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do resultado |
| `resultId` | `string` | Sim | ID publico do resultado |
| `jobId` | `string` | Sim | Job que gerou o resultado |
| `documentId` | `string` | Sim | Documento processado |
| `status` | `string` | Sim | Resultado final: `COMPLETED`, `PARTIAL`, `FAILED` |
| `requestedMode` | `string` | Sim | Modo pedido para o job relacionado |
| `outputVersion` | `string` | Sim | Versao do contrato de saida |
| `pipelineVersion` | `string` | Sim | Versao da pipeline |
| `promptVersion` | `string` | Nao | Versao do prompt |
| `modelVersion` | `string` | Nao | Versao do modelo |
| `normalizationVersion` | `string` | Nao | Versao das regras de normalizacao |
| `engineUsed` | `string` | Sim | Engine principal vencedora |
| `confidence` | `number` | Sim | Score global do documento |
| `totalLatencyMs` | `number` | Sim | Latencia fim a fim |
| `warnings` | `array<string>` | Nao | Warnings funcionais |
| `payload` | `string` | Nao | Texto consolidado com marcacoes semanticas |
| `createdAt` | `date` | Sim | Data de criacao |
| `updatedAt` | `date` | Sim | Data de atualizacao |

Indices sugeridos: `resultId` unico, `jobId`, `documentId`, `status`, `pipelineVersion`, `createdAt`.

## `page_artifacts`

| Campo | Tipo | Obrigatorio | Descricao |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do artefato |
| `artifactId` | `string` | Sim | ID publico do artefato |
| `documentId` | `string` | Sim | Documento relacionado |
| `jobId` | `string` | Sim | Job relacionado |
| `pageNumber` | `number` | Nao | Pagina de origem |
| `artifactType` | `string` | Sim | Ex.: `RENDERED_IMAGE`, `OCR_JSON`, `MASKED_TEXT` |
| `storageBucket` | `string` | Sim | Bucket do artefato |
| `storageObjectKey` | `string` | Sim | Chave do objeto no storage |
| `storageVersionId` | `string` | Nao | Versao do objeto |
| `mimeType` | `string` | Sim | MIME do artefato |
| `checksum` | `string` | Nao | Hash do artefato |
| `metadata` | `object` | Nao | Metadados livres por tipo |
| `createdAt` | `date` | Sim | Data de criacao |

Indices sugeridos: `artifactId` unico, `documentId`, `jobId`, `pageNumber`, `artifactType`.

## `audit_events`

| Campo | Tipo | Obrigatorio | Descricao |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do evento |
| `eventId` | `string` | Sim | ID publico do evento |
| `eventType` | `string` | Sim | Tipo do evento auditavel |
| `aggregateType` | `string` | Nao | Tipo do agregado afetado |
| `aggregateId` | `string` | Nao | ID do agregado afetado |
| `actor` | `object` | Nao | Quem executou a acao |
| `traceId` | `string` | Nao | Identificador de rastreio |
| `metadata` | `object` | Nao | Metadados operacionais |
| `redactedPayload` | `object` | Nao | Payload auditavel sem PII em claro |
| `createdAt` | `date` | Sim | Momento do evento |

Indices sugeridos: `eventId` unico, `eventType`, `aggregateType`, `aggregateId`, `createdAt`.

## `dead_letter_events`

| Campo | Tipo | Obrigatorio | Descricao |
| --- | --- | --- | --- |
| `_id` | `ObjectId` | Sim | Identificador interno do evento DLQ |
| `dlqEventId` | `string` | Sim | ID publico do evento |
| `jobId` | `string` | Nao | Job relacionado |
| `attemptId` | `string` | Nao | Tentativa relacionada |
| `queueName` | `string` | Nao | Fila de origem |
| `routingKey` | `string` | Nao | Routing key da mensagem |
| `messageId` | `string` | Nao | ID da mensagem original |
| `reasonCode` | `string` | Sim | Codigo padronizado do motivo |
| `reasonMessage` | `string` | Sim | Resumo do erro |
| `retryCount` | `number` | Sim | Quantidade de tentativas anteriores |
| `payloadSnapshot` | `object` | Nao | Payload sanitizado da mensagem |
| `firstSeenAt` | `date` | Sim | Primeira ocorrencia |
| `lastSeenAt` | `date` | Sim | Ultima ocorrencia |
| `replayedAt` | `date` | Nao | Momento de replay manual |
| `resolvedAt` | `date` | Nao | Momento de encerramento |

Indices sugeridos: `dlqEventId` unico, `jobId`, `reasonCode`, `lastSeenAt`.

## Fora do MVP

`Template Management` fica fora do contrato e do schema do MVP.
