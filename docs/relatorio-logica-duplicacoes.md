# Reavaliacao Tecnica das Duplicacoes e Melhorias Prioritarias

## Status

Este relatorio substitui a leitura informal feita em `2026-03-27` e consolida o estado real do repositorio em `2026-04-04`.

O diagnostico anterior ficou parcialmente desatualizado. Os pontos abaixo ja foram resolvidos em entregas posteriores e devem ser tratados como historico, nao como backlog aberto:

- coerencia de contexto no worker
- parsing estrito de `x-role`
- outbox transacional para publicacao
- centralizacao de `CompatibilityKey`
- centralizacao de `AuditEventRecorder`

## Reavaliacao do estado atual

### 1. Gate de qualidade e CI

O relatorio anterior registrava `19` erros de lint. Na reavaliacao tecnica, o backlog real estava materialmente maior e a leitura preliminar chegou a `91` erros no root. No worktree limpo usado para a execucao desta entrega, o estoque reproduzivel antes da correcao era `74`.

Essa diferenca mostrou dois problemas distintos:

- o gate de qualidade estava desligado na pratica
- a configuracao raiz do `eslint` misturava `TypeScript` tipado com scripts `Node` em `.cjs`

Status desta entrega:

- `eslint.config.mjs` foi separado para tratar `apps/packages` em `TypeScript` tipado e `tooling/**/*.cjs` com ambiente `Node`
- o backlog de lint foi zerado
- o workspace voltou a passar em `lint`, `typecheck`, `test:domain`, `test:application` e `test:e2e`
- o repositorio passou a ter `GitHub Actions` oficial para `push` e `pull_request`
- `test:contracts` real ficou em workflow separado, com `RUN_REAL_INFRA_TESTS=true`, fora do caminho obrigatorio de PR

### 2. Lifecycle, bootstrap e ownership de recursos

API e worker mantinham bootstrap semelhante, mas sem ownership claro dos recursos reais. O resultado era drift entre `runtime.config.ts`, fechamento manual disperso e risco de conexao pendurada no encerramento do processo.

Status desta entrega:

- a parte compartilhada de runtime foi extraida para `packages/shared-infrastructure/src/runtime.ts`
- resolucao de env, parsing de boolean/number, fallback de observabilidade e registry de recursos fechaveis ficaram centralizados
- `MongoDatabaseProvider` e `RabbitMqJobPublisherAdapter` reais passaram a ser registrados em uma `RuntimeResourceRegistry`
- a API passou a subir com `enableShutdownHooks()` e servico dedicado para fechar recursos reais
- o worker deixou de instanciar `RabbitMqProcessingJobListener` no `main.ts`
- o listener do worker passou a ser gerenciado por `ProcessingJobListenerLifecycleService`, inicializado so em runtime `real` e encerrado pelo lifecycle do Nest

## Concentracao atual das duplicacoes remanescentes

As duplicacoes abertas ja nao estao mais concentradas em `CompatibilityKey` ou `AuditEventRecorder`. Hoje elas aparecem mais em:

- bootstrap/runtime entre apps
- detalhes de wiring do outbox por servico
- read path operacional da API
- adapters de infraestrutura ainda finos, mas separados por app

## Prioridades apos esta rodada

### Mantidas como prioridade alta

1. consolidar mais wiring de runtime onde ainda houver drift entre API e worker
2. otimizar o read path operacional para reduzir fan-out por `traceId` e `attemptId`

### Reclassificadas para historico resolvido

- hardening de contexto do worker
- parsing de `x-role`
- outbox transacional
- duplicacao de `CompatibilityKey`
- duplicacao de `AuditEventRecorder`

## Evidencias desta entrega

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test:domain`
- `corepack pnpm test:application`
- `corepack pnpm test:e2e`

Os testes reais de infraestrutura continuam protegidos por workflow dedicado e opt-in local via `RUN_REAL_INFRA_TESTS=true`.
