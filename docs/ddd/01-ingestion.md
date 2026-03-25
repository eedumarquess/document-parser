# DDD: Ingestion

## Objetivo

Receber o documento, validar as restricoes de entrada, identificar o binario canonico por `hash`, persistir o original e decidir se o job deve ser enfileirado ou se pode reutilizar um resultado compativel.

## Decisoes fechadas do MVP

- Entrada apenas por `multipart/form-data`
- MIME types aceitos: `application/pdf`, `image/jpeg`, `image/png`
- Limites: `50 MB` e `10 paginas`
- O sistema nasce `single-tenant`
- Documentos com o mesmo `hash` reaproveitam o mesmo `Document`
- A chave oficial de compatibilidade e `hash + requestedMode + pipelineVersion + outputVersion`
- Quando existir resultado compativel e `forceReprocess=false`, um novo `ProcessingJob` deve ser criado com `reusedResult=true`
- `orchestrator-api` e worker compartilham o mesmo banco no MVP

## Modelo de dominio

### Agregado `Document`

Representa o binario canonico aceito pelo sistema.

#### Atributos principais

- `documentId`
- `hash`
- `originalFileName`
- `mimeType`
- `fileSizeBytes`
- `pageCount`
- `sourceType`
- `storageReference`
- `retentionUntil`
- `createdAt`
- `updatedAt`

#### Regras de negocio

- Um `Document` so existe apos o arquivo passar por validacao de tipo, tamanho e paginas.
- O `hash` e calculado antes da decisao de deduplicacao.
- O binario original precisa estar persistido antes do job sair de `STORED`.
- O `Document` representa o arquivo canonico; historico de processamento fica em `ProcessingJob`.

### Colaboracao com `ProcessingJob`

`Ingestion` cria sempre um novo job para cada submissao aceita:

- Se nao existir resultado compativel, o job segue para fila.
- Se existir resultado compativel e `forceReprocess=false`, o job e criado com `reusedResult=true`, referencia o resultado anterior e nao vai para fila.
- Se `forceReprocess=true`, o job ignora compatibilidade anterior e segue fluxo completo.

## Maquina de estado tocada por `Ingestion`

Estados de responsabilidade direta da API:

1. `RECEIVED`
2. `VALIDATED`
3. `STORED`
4. `DEDUPLICATED` quando houver reaproveitamento
5. `REPROCESSED` quando a origem for um comando manual de reprocessamento
6. `QUEUED` quando a mensagem for publicada

`COMPLETED`, `PARTIAL` e `FAILED` pertencem ao fechamento do ciclo e sao consolidados depois pelo worker ou pela propria API no fluxo de deduplicacao.

## Value objects

- `DocumentHash`
- `MimeType`
- `DocumentLimits`
- `StorageReference`
- `CompatibilityKey`
- `RetentionPolicy`

## Servicos de dominio

- `DocumentAcceptancePolicy`
- `CompatibleResultReusePolicy`
- `DocumentStoragePolicy`
- `PageCountPolicy`

## Portas

### Entrada

- `SubmitDocumentCommand`

### Saida

- `HashingPort`
- `PageCounterPort`
- `BinaryStoragePort`
- `DocumentRepositoryPort`
- `ProcessingJobRepositoryPort`
- `CompatibleResultLookupPort`
- `JobAttemptRepositoryPort`
- `JobPublisherPort`
- `ClockPort`
- `UnitOfWorkPort`

## Casos de uso principais

### `SubmitDocumentUseCase`

Sequencia esperada:

1. `validateUploadedFileConstraints`
2. `calculateDocumentHash`
3. `countDocumentPages`
4. `findExistingDocumentByHash`
5. `findCompatibleResultForSubmission`
6. `storeOriginalDocumentBinary`
7. `createProcessingJobForSubmission`
8. `createFirstAttemptWhenQueueing`
9. `publishProcessingJobRequested`

### Comportamento em duplicidade

Quando houver resultado compativel:

1. criar novo job com `reusedResult=true`
2. marcar o job como `DEDUPLICATED`
3. associar `sourceResultId` e `sourceJobId`
4. encerrar o novo job como `COMPLETED` ou `PARTIAL`, espelhando o resultado reutilizado
5. nao publicar mensagem em fila

## Eventos de dominio

- `DocumentAccepted`
- `DocumentRejected`
- `DocumentStored`
- `CompatibleResultReused`
- `ProcessingJobQueued`

## Regras de clean code para este contexto

- `controller` apenas traduz HTTP para `SubmitDocumentCommand`
- `use case` apenas coordena portas e politicas
- toda decisao booleana relevante deve ficar em funcao nomeada
- nomes genericos como `handleUpload` ou `processFile` devem ser evitados em regras internas

Exemplos de nomes esperados:

- `validateUploadedFileConstraints`
- `calculateDocumentHash`
- `buildCompatibilityKey`
- `shouldReuseCompatibleResult`
- `finalizeDeduplicatedJob`

## Plano de implementacao orientado a TDD

1. Criar testes de `DocumentAcceptancePolicy` cobrindo MIME, tamanho e paginas.
2. Criar testes de `CompatibilityKey` e `CompatibleResultReusePolicy`.
3. Criar testes de aplicacao para `SubmitDocumentUseCase` usando repositorios e storage em memoria.
4. Criar testes do fluxo de deduplicacao com `reusedResult=true`.
5. Criar contract tests para adapters de `MongoDB`, `MinIO` e `RabbitMQ`.
6. Criar um teste E2E para `POST /v1/parsing/jobs` cobrindo upload valido e resposta de aceite.

## Cenarios de teste obrigatorios

- aceita `PDF`, `JPEG` e `PNG`
- rejeita MIME nao suportado
- rejeita arquivo acima de `50 MB`
- rejeita documento acima de `10 paginas`
- reaproveita `Document` existente quando o `hash` coincide
- cria novo job com `reusedResult=true` quando encontra resultado compativel
- ignora reutilizacao quando `forceReprocess=true`
- so publica em fila depois que o original estiver persistido

## Anti-corruption rules

- HTTP nao entra no dominio
- `multipart` e detalhe de adapter
- `MinIO` e acessado apenas por `BinaryStoragePort`
- `RabbitMQ` e acessado apenas por `JobPublisherPort`
