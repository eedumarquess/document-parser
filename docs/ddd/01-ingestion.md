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

## Estado atual no repositorio

O contexto de `Ingestion` ja tem uma base funcional no `orchestrator-api`:

- `SubmitDocumentUseCase` ja valida upload, calcula `hash`, persiste `Document`, cria `ProcessingJob`, cria `JobAttempt`, publica em fila e fecha o fluxo de deduplicacao
- `DocumentAcceptancePolicy`, `CompatibilityKey` e `CompatibleResultReusePolicy` ja possuem cobertura inicial de testes
- existe E2E cobrindo upload valido, consulta de status e consulta de resultado

Os gaps mais relevantes para fechar este contexto contra o desenho alvo deste documento sao:

- os adapters padrao ainda sao somente `in-memory`; faltam `MongoDB`, `MinIO` e `RabbitMQ`
- ainda nao existe `UnitOfWorkPort`, entao persistencia e publicacao nao estao protegidas por uma fronteira transacional explicita
- a busca de resultado compativel ainda esta acoplada a `ProcessingResultRepositoryPort`; o documento pede uma porta dedicada de lookup
- a maquina `RECEIVED -> VALIDATED -> STORED -> DEDUPLICATED|REPROCESSED|QUEUED` ainda nao aparece de forma explicita no modelo
- faltam testes de falha e ordenacao para garantir que nunca haja publicacao em fila antes da persistencia do binario

## Plano de implementacao orientado ao estado atual

### Etapa 1: alinhar modelo, contratos e linguagem ubiqua

1. Resolver a ambiguidade da sequencia oficial do caso de uso.
   `validateUploadedFileConstraints` depende de `pageCount`, mas a sequencia atual do documento coloca `calculateDocumentHash` antes de `countDocumentPages`. A recomendacao e tratar `countDocumentPages` como parte da validacao ou oficializar a ordem `countDocumentPages -> validateUploadedFileConstraints -> calculateDocumentHash`.
2. Introduzir `CompatibleResultLookupPort` separado de `ProcessingResultRepositoryPort`.
   O objetivo e deixar claro que `Ingestion` precisa consultar compatibilidade, nao conhecer detalhes de persistencia de resultado.
3. Introduzir `UnitOfWorkPort`.
   Esta porta deve encapsular a gravacao de `Document`, `ProcessingJob`, `JobAttempt`, auditoria e o ponto seguro antes de publicar em fila.
4. Decidir onde a maquina de estados de `Ingestion` sera representada.
   A recomendacao pratica para o MVP e persistir os timestamps e os estados em `ProcessingJob`, sem criar outro agregado so para isso.
5. Formalizar os eventos de dominio do contexto como artefatos nomeados.
   Mesmo que a publicacao real comece apenas por auditoria interna, os eventos `DocumentAccepted`, `DocumentRejected`, `DocumentStored`, `CompatibleResultReused` e `ProcessingJobQueued` devem existir como linguagem do codigo e dos testes.

### Etapa 2: fechar a fatia de dominio e aplicacao

1. Refatorar `SubmitDocumentUseCase` para espelhar os passos nomeados deste documento.
   Extrair metodos como `validateUploadedFileConstraints`, `calculateDocumentHash`, `findExistingDocumentByHash`, `findCompatibleResultForSubmission`, `storeOriginalDocumentBinary`, `createProcessingJobForSubmission`, `createFirstAttemptWhenQueueing` e `publishProcessingJobRequested`.
2. Tornar explicita a transicao de estados de `Ingestion`.
   O job deve deixar rastros claros de `VALIDATED`, `STORED`, `DEDUPLICATED` e `QUEUED`, inclusive no fluxo de reprocessamento.
3. Fechar o fluxo de deduplicacao com espelhamento completo do resultado.
   Alem de `reusedResult=true`, o novo job deve sempre carregar `sourceJobId`, `sourceResultId` e terminalidade coerente com o resultado reutilizado.
4. Endurecer o caminho de erro.
   Falha em storage nao pode criar job. Falha depois de persistir o binario mas antes da fila precisa ser transacionada ou explicitamente compensada.
5. Separar responsabilidade de auditoria de responsabilidade de orquestracao.
   O caso de uso deve registrar eventos semanticamente corretos, nao apenas um unico `PROCESSING_JOB_QUEUED`.

### Etapa 3: implementar adapters reais do MVP

1. Criar adapter de `MongoDB` para `documents`, `processing_jobs`, `job_attempts` e lookup de resultados compativeis.
2. Criar adapter de `MinIO` para `BinaryStoragePort`, incluindo convencao de `bucket`, `objectKey` e politicas minimas de retencao.
3. Criar adapter de `RabbitMQ` para `JobPublisherPort` com o payload minimo oficial do contexto.
4. Implementar `UnitOfWorkPort` para o conjunto de operacoes no banco.
   Publicacao em fila deve acontecer apenas apos `commit` bem-sucedido.
5. Ajustar `OrchestratorApiModule` para selecionar adapters reais por configuracao, mantendo os `in-memory` apenas para testes e bootstrap local.

### Etapa 4: fechar a cobertura de testes que falta

1. Expandir testes de dominio.
   Cobrir arquivo vazio, combinacoes limite de tamanho e paginas, e regras de reuso com `COMPLETED` e `PARTIAL`.
2. Expandir testes de aplicacao do `SubmitDocumentUseCase`.
   Cobrir reuso de `Document` por `hash`, deduplicacao com `sourceResultId`, bypass com `forceReprocess=true` e garantia de ordem `store -> save -> publish`.
3. Criar testes de falha orientados a infraestrutura.
   Simular erro em `BinaryStoragePort`, erro em repositorio e erro em `JobPublisherPort` para validar rollback ou compensacao.
4. Criar contract tests dos adapters reais.
   Validar contrato de `MongoDB`, `MinIO` e `RabbitMQ` contra doubles compartilhados pelo `testkit`.
5. Criar E2E especificos de `Ingestion`.
   Um caso de aceite normal, um caso de deduplicacao sem fila, um caso com `forceReprocess=true` e um caso de rejeicao por limite excedido.

### Etapa 5: criterio de pronto do contexto

O contexto de `Ingestion` pode ser considerado fechado no MVP quando todos os itens abaixo forem verdadeiros:

- `POST /v1/parsing/jobs` aceita `multipart/form-data` com `PDF`, `JPEG` e `PNG`
- o binario original e persistido antes de qualquer publicacao em fila
- `Document` e reaproveitado por `hash`
- um novo `ProcessingJob` e sempre criado por submissao aceita
- quando existe resultado compativel e `forceReprocess=false`, o job termina como deduplicado e nao publica mensagem
- quando `forceReprocess=true`, o reuso e ignorado e o job segue para fila
- os adapters reais de `MongoDB`, `MinIO` e `RabbitMQ` passam em contract tests
- existe E2E cobrindo o caminho feliz, deduplicacao e validacoes de entrada

## Sequencia recomendada de execucao

1. Refatorar testes e contratos primeiro, sem trocar infra.
2. Ajustar `SubmitDocumentUseCase` e o modelo de estados.
3. Introduzir `CompatibleResultLookupPort` e `UnitOfWorkPort`.
4. Implementar adapters reais de `MongoDB`, `MinIO` e `RabbitMQ`.
5. Fechar contract tests e E2E com a infraestrutura real ou containerizada.

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
