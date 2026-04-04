# Relatório de Análise: Lógicas Erradas e Funções Duplicadas

Data da análise: 2026-03-27

## Objetivo

Identificar:

- lógicas potencialmente incorretas ou frágeis;
- duplicações reais de função/comportamento no sistema;
- recomendações de melhoria com prioridade de execução.

## Escopo e verificações executadas

Escopo revisado:

- `apps/orchestrator-api`
- `apps/document-processing-worker`
- `packages/document-processing-domain`
- `packages/shared-kernel`

Verificações executadas:

- `corepack pnpm run typecheck`
- `corepack pnpm run test:domain`
- `corepack pnpm run lint`

Resultado:

- `typecheck`: passou
- `test:domain`: passou
- `lint`: falhou com 19 erros

Observação: os testes de domínio passaram, então os principais riscos encontrados estão mais concentrados em consistência entre componentes, bordas HTTP/autorização e duplicação de infraestrutura.

## Achados de lógica

### FEITO - 1. Alta: o worker não valida coerência entre `job`, `document` e `attempt`

Problema:

O carregador de contexto do worker valida apenas a existência dos registros, mas não valida o relacionamento entre eles.

Risco:

- um `attemptId` de outro job pode ser aceito;
- um `documentId` divergente pode ser aceito;
- o worker pode ler o binário de um documento e persistir resultado/estado em outro job;
- isso abre espaço para processamento cruzado e corrupção de estado.

Referências:

- `apps/document-processing-worker/src/application/services/processing-context-loader.service.ts:39`
- `apps/document-processing-worker/src/application/services/attempt-execution-coordinator.service.ts:46`

Recomendação:

- validar explicitamente:
  - `attempt.jobId === job.jobId`
  - `job.documentId === document.documentId`
  - `message.jobId === job.jobId`
  - `message.documentId === document.documentId`
  - `message.attemptId === attempt.attemptId`
- tratar divergência como erro fatal de contexto, com auditoria e DLQ.

### FEITO - 2. Alta: há janela de inconsistência entre publicação na fila e persistência final do estado

Problema:

Em vários fluxos, a mensagem é publicada com sucesso e só depois o sistema tenta persistir o estado final (`QUEUED` ou nova tentativa).

Risco:

- a fila pode conter uma mensagem válida;
- o banco pode continuar sem o estado correspondente;
- o worker pode consumir mensagens para entidades ainda não refletidas como enfileiradas;
- o sistema entra em estado inconsistente e mais difícil de operar.

Pontos onde isso acontece:

- submissão de documento
- criação de job derivado para reprocessamento/replay
- agendamento de retry no worker

Referências:

- `apps/orchestrator-api/src/application/use-cases/submit-document.use-case.ts:197`
- `apps/orchestrator-api/src/application/services/derived-job-orchestrator.service.ts:97`
- `apps/document-processing-worker/src/application/services/processing-failure-recovery.service.ts:89`

Recomendação:

- adotar padrão outbox transacional; ou
- introduzir um estado intermediário persistido antes da publicação; ou
- persistir a nova tentativa/estado antes do publish, com semântica explícita de “pendente de publicação”.

Observação:

O desenho atual funciona em cenário feliz, mas é frágil sob falhas entre broker e persistência.

### FEITO - 3. Média: `x-role` inválido vira `OWNER`

Problema:

Os controllers convertem qualquer valor diferente de `OPERATOR` em `OWNER`.

Risco:

- um header inválido ou com typo recebe privilégio máximo;
- erro de cliente vira elevação de privilégio;
- a autorização confia nesse papel já resolvido.

Referências:

- `apps/orchestrator-api/src/adapters/in/http/document-jobs.controller.ts:145`
- `apps/orchestrator-api/src/adapters/in/http/operational-jobs.controller.ts:72`
- `apps/orchestrator-api/src/adapters/in/http/dead-letters.controller.ts:50`
- `apps/orchestrator-api/src/adapters/out/auth/simple-rbac.adapter.ts:6`

Recomendação:

- manter o default `OWNER` apenas quando o header estiver ausente, se isso for regra deliberada;
- rejeitar valores inválidos com `400`;
- centralizar parsing de ator/role para evitar reaplicação do mesmo erro em múltiplos controllers.

### FEITO - 4. Média: falha de enfileiramento pode ficar invisível no endpoint público de status

Problema:

Quando a publicação na fila falha, o handler grava `errorCode`, mas o `status` pode continuar em estado intermediário como `STORED`. O endpoint público de status expõe apenas o `status`, sem `errorCode` ou `errorMessage`.

Risco:

- o cliente pode ver um job como “armazenado” em vez de “com falha no enfileiramento”;
- troubleshooting operacional fica dependente do endpoint operacional, logs ou auditoria;
- a API pública pode induzir diagnóstico incorreto.

Referências:

- `apps/orchestrator-api/src/application/services/queue-publication-failure-handler.service.ts:23`
- `packages/document-processing-domain/src/job-lifecycle.ts:207`
- `apps/orchestrator-api/src/application/use-cases/get-job-status.use-case.ts:98`
- `apps/orchestrator-api/src/contracts/http.ts:3`

Recomendação:

- definir estado explícito para falha de enfileiramento; ou
- converter esse caso para `FAILED`; ou
- ampliar o contrato de status para incluir `errorCode` e `errorMessage`.

## Duplicações identificadas

### 1. Duplicação de helpers HTTP nos controllers da API

Duplicado:

- `resolveRequestContext`
- `resolveActor`
- `toHttpException`
- `buildErrorResponse`

Onde:

- `apps/orchestrator-api/src/adapters/in/http/document-jobs.controller.ts:133`
- `apps/orchestrator-api/src/adapters/in/http/operational-jobs.controller.ts:60`
- `apps/orchestrator-api/src/adapters/in/http/dead-letters.controller.ts:50`

Impacto:

- mesma regra defeituosa de parsing de role espalhada;
- correções exigem edição em múltiplos pontos;
- aumenta risco de drift entre endpoints.

Recomendação:

- extrair para um util compartilhado de controller ou camada HTTP comum.

### 2. `AuditEventRecorder` duplicado entre API e worker

Onde:

- `apps/orchestrator-api/src/application/services/audit-event-recorder.service.ts:1`
- `apps/document-processing-worker/src/application/services/audit-event-recorder.service.ts:1`

Diferença real:

- no worker existe `SYSTEM_ACTOR` padrão;
- fora isso, a estrutura é praticamente a mesma.

Recomendação:

- mover a implementação base para pacote compartilhado;
- deixar apenas a política de actor default como customização por app.

### 3. `CompatibilityKey.build()` duplicado

Onde:

- `apps/orchestrator-api/src/domain/value-objects/compatibility-key.ts:1`
- `apps/document-processing-worker/src/domain/value-objects/compatibility-key.ts:1`

Impacto:

- regra central de compatibilidade está replicada;
- já existe pequeno drift semântico: comentário/regra presente na API e ausente no worker.

Recomendação:

- mover para `packages/document-processing-domain` ou `packages/shared-kernel`.

### 4. Infraestrutura duplicada entre apps

Duplicações literais:

- `SystemClockAdapter`
- `RandomIdGeneratorAdapter`
- `RabbitMqJobPublisherAdapter`
- `MongoDatabaseProvider`
- `MongoUnitOfWorkAdapter`

Onde:

- `apps/orchestrator-api/src/adapters/out/clock/system-clock.adapter.ts:1`
- `apps/document-processing-worker/src/adapters/out/clock/system-clock.adapter.ts:1`
- `apps/orchestrator-api/src/adapters/out/clock/random-id-generator.adapter.ts:1`
- `apps/document-processing-worker/src/adapters/out/clock/random-id-generator.adapter.ts:1`
- `apps/orchestrator-api/src/adapters/out/queue/rabbitmq-job-publisher.adapter.ts:1`
- `apps/document-processing-worker/src/adapters/out/queue/rabbitmq-job-publisher.adapter.ts:1`
- `apps/orchestrator-api/src/adapters/out/repositories/mongodb.provider.ts:1`
- `apps/document-processing-worker/src/adapters/out/repositories/mongodb.provider.ts:1`

Impacto:

- custo de manutenção duplicado;
- alto risco de drift técnico em infraestrutura transversal.

Recomendação:

- extrair para pacote compartilhado de infraestrutura comum, se isso fizer sentido para o monorepo.

### 5. `toJobResponse` repetido em múltiplos use cases

Onde:

- `apps/orchestrator-api/src/application/use-cases/submit-document.use-case.ts:578`
- `apps/orchestrator-api/src/application/use-cases/reprocess-document.use-case.ts:185`
- `apps/orchestrator-api/src/application/use-cases/replay-dead-letter.use-case.ts:200`

Impacto:

- duplicação pequena, mas desnecessária;
- risco de drift no contrato de resposta.

Recomendação:

- extrair mapper único de `JobResponse`.

## Recomendações de melhoria

### Prioridade 1

1. Validar consistência do contexto no worker antes de qualquer leitura/escrita.
2. Endurecer parsing de `x-role` para rejeitar valores inválidos.
3. Cobrir ambos os pontos com testes de aplicação e e2e.

### Prioridade 2

1. Redesenhar publicação em fila com outbox ou estado intermediário persistido.
2. Tornar falha de enfileiramento visível no contrato público de status.
3. Revisar semântica de retry para reduzir estados “ambíguos” do job.

### Prioridade 3

1. Centralizar helpers HTTP.
2. Centralizar `CompatibilityKey`.
3. Centralizar `AuditEventRecorder`.
4. Consolidar adapters idênticos de clock, ID, RabbitMQ e provider Mongo.

## Quick Wins

- Criar um parser único de actor/trace/context para os controllers HTTP.
- Adicionar teste que envia `x-role: INVALID_ROLE` e espera `400`.
- Adicionar teste que injeta mensagem com `attemptId` de outro job e espera DLQ/erro fatal.
- Criar mapper compartilhado de `JobResponse`.
- Unificar `CompatibilityKey` imediatamente, pois é pequena e central.

## Riscos residuais

- `typecheck` e testes de domínio não cobrem essas inconsistências de integração.
- A maior parte dos riscos aparece em cenários de borda:
  - falha entre banco e broker;
  - mensagens inconsistentes;
  - headers inválidos;
  - troubleshooting operacional por contrato público limitado.

## Conclusão

O sistema está estruturalmente organizado e com domínio/testes básicos consistentes, mas há três pontos que merecem correção prioritária:

- coerência entre `job`, `document` e `attempt` no worker;
- consistência transacional entre persistência e publicação em fila;
- parsing/autorização de role na borda HTTP.

As duplicações encontradas não são apenas estéticas: algumas já amplificam risco real de comportamento divergente e de repetição de bug.
