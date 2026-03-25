# DDD: Result Delivery

## Objetivo

Expor para o consumidor externo o status do `ProcessingJob`, o `ProcessingResult` final e o comando de reprocessamento manual sem vazar a complexidade interna de fila, tentativas, deduplicacao, fallback e persistencia de artefatos.

## Decisoes fechadas do MVP

- `orchestrator-api` publica os endpoints `POST /v1/parsing/jobs`, `GET /v1/parsing/jobs/{jobId}`, `GET /v1/parsing/jobs/{jobId}/result` e `POST /v1/parsing/jobs/{jobId}/reprocess`
- o contrato externo do resultado continua sendo texto consolidado com marcacoes semanticas, nao um conjunto obrigatorio de campos estruturados
- o contrato de status e propositalmente menor que o modelo interno do job e ja expoe `reusedResult` para tornar transparente o reaproveitamento compativel
- `GET /result` so entrega resultados persistidos em `processing_results`, portanto hoje so cobre `COMPLETED` e `PARTIAL`
- falha definitiva continua sendo lida pelo status do job; nao existe ainda um payload canonico de falha em `GET /result`
- reprocessamento exige `reason` nao vazio e cria sempre um novo job para o mesmo `documentId`
- o sistema segue `single-tenant`, com RBAC simples `OWNER` e `OPERATOR`
- o ambiente suporta `runtime mode` em memoria e `runtime mode` real; no modo real a API usa `MongoDB`, `MinIO` e `RabbitMQ`
- defaults atuais do repositorio: `requestedMode=STANDARD`, `outputVersion=1.0.0`, `pipelineVersion=dev-sha`

## Fronteira e ownership do contexto

- `Ingestion` continua dono do `Document`, do aceite do binario e da idempotencia por hash
- `Document Processing` continua dono do ciclo de vida do `ProcessingJob`, do `JobAttempt`, de retries, DLQ e estados finais
- `OCR/LLM Extraction` continua dono da producao do `payload`, de `warnings`, `confidence` e artefatos tecnicos
- `Result Delivery` e a fronteira da `orchestrator-api` que traduz o estado interno para contratos HTTP de leitura e para o comando manual de reprocessamento

## Modelo atual no repositorio

### Projecao externa `JobResponse`

Resposta usada por:

- `POST /v1/parsing/jobs`
- `GET /v1/parsing/jobs/{jobId}`
- `POST /v1/parsing/jobs/{jobId}/reprocess`

Campos atuais:

- `jobId`
- `documentId`
- `status`
- `requestedMode`
- `pipelineVersion`
- `outputVersion`
- `reusedResult`
- `createdAt`

Observacoes:

- `status` pode refletir qualquer estado oficial do `ProcessingJob`, incluindo `QUEUED`, `PROCESSING`, `PARTIAL`, `COMPLETED` e `FAILED`
- o contrato atual nao expoe `finishedAt`, `errorCode`, `errorMessage`, `warnings`, `reprocessOfJobId` ou lineage de resultado

### Agregado canonico lido pela API: `ProcessingResult`

No estado atual do codigo, a API le o agregado canonico persistido pelo worker, sem um read model separado.

Campos relevantes ja existentes:

- `resultId`
- `jobId`
- `documentId`
- `compatibilityKey`
- `status`
- `requestedMode`
- `pipelineVersion`
- `outputVersion`
- `confidence`
- `warnings`
- `payload`
- `engineUsed`
- `totalLatencyMs`
- `promptVersion`
- `modelVersion`
- `normalizationVersion`
- `sourceJobId`
- `createdAt`
- `updatedAt`

Regra importante:

- `ProcessingResult.status` hoje e apenas `COMPLETED` ou `PARTIAL`
- `FAILED` pertence ao `ProcessingJob` e ao `JobAttempt`; nao existe `ProcessingResult` com falha

### Autorizacao atual

O controle de acesso nao esta modelado como um `ResultAccessPolicy` dedicado. No repositorio atual ele fica centralizado em `AuthorizationPort`, com adapter simples:

- `OWNER` pode submeter, consultar e reprocessar
- `OPERATOR` pode consultar status e resultado

No controller:

- `x-actor-id` default para `local-owner`
- `x-role` default para `OWNER` quando ausente ou invalido

## Contratos HTTP atuais

### `GET /v1/parsing/jobs/{jobId}`

Resposta atual:

```json
{
  "jobId": "job_123",
  "documentId": "doc_123",
  "status": "COMPLETED",
  "requestedMode": "STANDARD",
  "pipelineVersion": "dev-sha",
  "outputVersion": "1.0.0",
  "reusedResult": false,
  "createdAt": "2026-03-25T10:00:00.000Z"
}
```

Uso esperado:

- consultar progresso de jobs assincronos
- detectar `FAILED` e entender que, no estado atual, `GET /result` seguira sem payload persistido
- detectar reaproveitamento via `reusedResult=true`

### `GET /v1/parsing/jobs/{jobId}/result`

Resposta atual:

```json
{
  "jobId": "job_123",
  "documentId": "doc_123",
  "status": "COMPLETED",
  "requestedMode": "STANDARD",
  "pipelineVersion": "dev-sha",
  "outputVersion": "1.0.0",
  "confidence": 0.91,
  "warnings": [],
  "payload": "Paciente consciente. Observacao manuscrita: [ilegivel]."
}
```

Comportamento atual:

- valida permissao de leitura antes de consultar o repositorio
- falha com `NOT_FOUND` quando o `jobId` nao existe
- falha com `NOT_FOUND` quando o job existe, mas ainda nao ha `ProcessingResult`
- registra auditoria `RESULT_QUERIED` com `jobId` e `documentId`

O contrato atual nao expoe por padrao:

- `resultId`
- `compatibilityKey`
- `engineUsed`
- `totalLatencyMs`
- `promptVersion`
- `modelVersion`
- `normalizationVersion`
- `sourceJobId`
- `createdAt`
- links para artefatos tecnicos

### `POST /v1/parsing/jobs/{jobId}/reprocess`

Payload atual:

```json
{
  "reason": "model update"
}
```

Resposta atual:

```json
{
  "jobId": "job_456",
  "documentId": "doc_123",
  "status": "QUEUED",
  "requestedMode": "STANDARD",
  "pipelineVersion": "dev-sha",
  "outputVersion": "1.0.0",
  "reusedResult": false,
  "createdAt": "2026-03-25T11:00:00.000Z"
}
```

Efeitos observaveis do caso de uso:

- exige `OWNER`
- exige `reason` nao vazio
- cria novo job com `reprocessOfJobId` apontando para o job anterior
- cria novo `JobAttempt` inicial
- publica nova mensagem na fila
- preserva historico anterior

## Regras de negocio

- `GET /status` e o contrato oficial para acompanhar o ciclo de vida do job
- `GET /result` e o contrato oficial apenas para resultados utilizaveis ja persistidos
- resultado reaproveitado por compatibilidade continua aparecendo como um novo job, mas com `reusedResult=true`
- reaproveitamento compativel nao publica nova mensagem em fila e nao cria novo `JobAttempt`
- reprocessamento nunca sobrescreve job ou resultado anterior
- quando a pipeline produz `payload` com `[ilegivel]` ou qualquer `warning`, o worker tende a classificar o resultado como `PARTIAL`
- quando o processamento falha de forma terminal, o job vai para `FAILED`, mas `GET /result` continua sem payload canonico de erro
- estabilidade externa deve ser tratada por `outputVersion`, mesmo quando detalhes internos do worker evoluirem

## Estado atual no repositorio

O contexto de `Result Delivery` ja tem base funcional no codigo atual:

- `DocumentJobsController` ja expoe os endpoints de submissao, status, resultado e reprocessamento
- `GetJobStatusUseCase` ja consulta o job, valida autorizacao e monta `JobResponse`
- `GetProcessingResultUseCase` ja consulta job e resultado, registra auditoria e monta `ResultResponse`
- `ReprocessDocumentUseCase` ja cria um novo job, cria `JobAttempt`, publica mensagem e audita a operacao
- `SubmitDocumentUseCase` ja suporta reaproveitamento por `compatibilityKey` e cria um novo `ProcessingResult` vinculado ao novo job quando a resposta for deduplicada
- `ProcessingResultEntity` no worker ja persiste `compatibilityKey`, `confidence`, `warnings`, `engineUsed`, latencia total e versoes tecnicas
- `SimpleRbacAuthorizationAdapter` ja aplica o RBAC minimo do MVP
- a API suporta `ORCHESTRATOR_RUNTIME_MODE=memory|real`
- o worker suporta `WORKER_RUNTIME_MODE=memory|real`
- no modo real, a API usa `MongoDB` para repositorios, `MinIO` para binarios e `RabbitMQ` para publicacao do job
- os testes `E2E` ja cobrem upload, consulta de status, consulta de resultado, `PARTIAL` com `[ilegivel]` e bloqueio de reprocessamento para `OPERATOR`

## Gaps relevantes a partir do estado atual

Os principais gaps do desenho anterior, quando comparado ao ambiente atual do repositorio, sao:

- o documento antigo tratava `FAILED` como status valido de `ProcessingResult`, mas o modelo atual persiste resultado apenas para `COMPLETED` e `PARTIAL`
- o documento antigo assumia um `ResultAccessPolicy` dedicado, mas o codigo atual centraliza isso em `AuthorizationPort`
- o documento antigo assumia `ResultAssemblerService`, `ResultErrorContractService` e `ReprocessAuthorizationService`, mas hoje o mapeamento de resposta fica inline nos casos de uso
- o documento antigo falava em `ProcessingJobReadModelPort` e `ProcessingResultReadModelPort`, mas hoje as queries leem diretamente os repositories canonicos
- o documento antigo dizia que `FAILED` retornaria metadados pelo endpoint de resultado; isso nao acontece hoje, pois `GET /result` devolve `NOT_FOUND` quando nao ha resultado persistido
- o documento antigo nao refletia `reusedResult`, que ja faz parte do contrato publico de status
- o documento antigo nao refletia `compatibilityKey` e `sourceJobId`, que ja existem internamente e sustentam o reaproveitamento
- o documento antigo nao refletia a auditoria explicita de consulta ao resultado
- o documento antigo nao refletia os `runtime modes` em memoria e real nem a dependencia real de `MongoDB`, `MinIO` e `RabbitMQ`

Os gaps de produto ainda abertos no contexto sao:

- falta decidir se `GET /status` deve passar a expor `errorCode`, `errorMessage`, `finishedAt` e `warnings`
- falta decidir se `GET /result` deve ganhar contrato explicito para falha funcional ou se o consumidor deve continuar obrigatoriamente consultando `GET /status`
- falta um endpoint de lineage para expor `sourceJobId`, `sourceResultId` e `reprocessOfJobId`
- faltam endpoints para artefatos tecnicos ou links temporarios assinados
- falta separar queries em read models dedicados se o contrato publico crescer e deixar de ser uma projecao simples dos agregados canonicos
- faltam testes de aplicacao dedicados para `GetJobStatusUseCase` e `GetProcessingResultUseCase`

## Plano de evolucao orientado ao estado atual

### Etapa 1: fechar o contrato externo minimo

1. Decidir se o consumidor le erro apenas por `GET /status` ou se `GET /result` passara a ter payload de falha canonico.
2. Decidir se `JobResponse` precisa expor `finishedAt`, `errorCode`, `errorMessage` e `warnings`.
3. Confirmar se `reusedResult` permanece apenas no status ou tambem deve aparecer no resultado.

### Etapa 2: extrair montagem de resposta se o contrato crescer

1. Manter o mapeamento inline enquanto o contrato for pequeno.
2. Extrair um `ResultResponseAssembler` apenas quando houver mais de um formato publico ou derivacoes de campo.
3. Evitar criar um assembler abstrato antes de existir duplicacao real.

### Etapa 3: separar leitura operacional de modelo canonico

1. Introduzir `read model` dedicado apenas se surgirem filtros, lineage, joins com auditoria ou artefatos.
2. Preservar os repositories canonicos enquanto o acesso continuar sendo `findById` e `findByJobId`.
3. Garantir que a regra de negocio continue fora do controller mesmo com read model separado.

### Etapa 4: ampliar observabilidade publica quando fizer sentido

1. Expor lineage de deduplicacao e reprocessamento.
2. Expor artefatos tecnicos por endpoint proprio ou links temporarios.
3. Padronizar qual parte da falha e segura para o consumidor externo.

### Etapa 5: fechar a cobertura de testes que falta

1. Criar testes de aplicacao dedicados para `GetJobStatusUseCase`.
2. Criar testes de aplicacao dedicados para `GetProcessingResultUseCase`.
3. Criar `E2E` de reprocessamento bem-sucedido.
4. Criar testes de contrato HTTP para payload de erro em `NOT_FOUND`, `AUTHORIZATION_ERROR` e `VALIDATION_ERROR`.

## Regras de clean code para este contexto

- controllers devem apenas traduzir HTTP para caso de uso e mapear erro de aplicacao para `HttpException`
- autorizacao deve continuar centralizada em `AuthorizationPort`, nunca espalhada por `if` de role dentro dos casos de uso
- enquanto o contrato for pequeno, montar resposta inline e explicitamente e mais claro do que introduzir assembler especulativo
- se o contrato crescer, extrair montagem de resposta para um objeto com nomes explicitos como `buildJobResponse` e `buildResultResponse`
- `GET /result` nao deve inferir payload de falha quando nao existir `ProcessingResult`; esse comportamento precisa ser decisao de produto antes de virar codigo
- reprocessamento deve continuar em caso de uso proprio, nunca como branch escondido em `submit`

## Cenarios de teste obrigatorios

- retorna `JobResponse` minimo para job existente
- retorna `NOT_FOUND` quando o `jobId` nao existir em `GET /status`
- retorna `ResultResponse` minimo para job concluido
- retorna `PARTIAL` com `warnings` e marcador `[ilegivel]` quando o payload for incompleto
- registra auditoria `RESULT_QUERIED` ao consultar resultado
- retorna `NOT_FOUND` quando o job existir, mas ainda nao houver resultado
- cria novo job ao reprocessar e preserva `reprocessOfJobId`
- bloqueia reprocessamento para `OPERATOR`
- expoe `reusedResult=true` quando a submissao reaproveitar resultado compativel
