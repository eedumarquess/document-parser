# Changelog

Todas as mudancas relevantes deste repositorio devem ser registradas aqui.

O formato segue uma adaptacao simples de `Keep a Changelog` e usa as tags de contexto dos commits como apoio para rastreabilidade.

## [2026-03-29] - Bootstrap Docker para desenvolvimento e producao

### Added

- `Dockerfile` multi-stage com alvo `dev` para workspace montado e alvo `prod` para imagem final unica reutilizavel por `api` ou `worker`.
- `docker-compose.dev.yml` para subir `api-dev` e `worker-dev` em runtime `real`, apontando para `MongoDB`, `RabbitMQ` e `MinIO` externos ao compose.
- Scripts de bootstrap para instalar o monorepo no container, validar `PNPM_LINK_MAP`, instalar libs irmas e aplicar `pnpm link` por workspace consumidor.
- Exemplos de ambiente `.env.example` e `.env.docker.dev.example` com as variaveis obrigatorias de runtime real e opcoes de LLM remoto.

### Changed

- O repositorio passou a expor scripts `docker:dev:bootstrap`, `docker:dev:api` e `docker:dev:worker` no `package.json`.
- O README agora documenta bootstrap sem Docker, fluxo Docker de desenvolvimento com infra externa e build/runtime da imagem de producao.
- O versionamento ignorado passou a preservar `.env.docker.dev.example` junto de `.env.example`.

### Technical Notes

- O compose de desenvolvimento monta `..:/workspace`, mantendo visibilidade de repositorios irmaos para `pnpm link`.
- A imagem final usa `node tooling/scripts/docker-entrypoint.cjs` e aceita `api` como `CMD` default ou `worker` como argumento explicito.
- A validacao executada nesta entrega cobriu `corepack pnpm build`, carga dos scripts Node e `docker compose -f docker-compose.dev.yml config`.
- O `docker build --target prod` nao foi executado no ambiente desta entrega porque o engine local do Docker estava indisponivel.

### Commit Contexts

- `feat(docker-image): adicionar build multi-stage e entrypoint`
- `feat(docker-dev): adicionar compose e bootstrap com pnpm link`
- `feat(docker-env): adicionar scripts e exemplos de ambiente`
- `docs(docker): documentar bootstrap e runtime`
- `docs(changelog): registrar bootstrap Docker`

## [2026-03-28] - Falha terminal de publicacao no outbox do orchestrator

### Added

- Novo estado terminal `FAILED` para `QueuePublicationOutboxStatus`, permitindo fechar o registro do outbox sem mantê-lo elegivel para novo claim.
- Cobertura dedicada para falha terminal de publicacao no dominio, no dispatcher do orchestrator, nas leituras publicas/operacionais e no E2E de `document-jobs`.

### Changed

- `QueuePublicationOutboxDispatcherService` da `orchestrator-api` deixou de reagendar publish com falha e passou a finalizar o erro na primeira tentativa.
- `QueuePublicationFailureHandler` passou a ser o caminho oficial da falha de publicacao do outbox, persistindo `job`, `attempt` e `outbox` de forma terminal.
- `recordJobError` agora adiciona a transicao `FAILED` em `ingestionTransitions` quando a falha e terminal.

### Fixed

- Jobs aceitos pela API nao ficam mais presos em `PUBLISH_PENDING` quando a confirmacao de publish no broker falha.
- `GET /v1/parsing/jobs/:jobId` agora converge para `FAILED` nesse cenario, sem depender de `errorCode` ou `errorMessage` no contrato publico.
- O contexto operacional passou a refletir falha terminal de enfileiramento com `queuePublication.status=FAILED` e `lastError` preenchido.

### Technical Notes

- O `JobAttempt` inicial tambem passa a `FAILED` quando a publicacao falha antes de chegar ao worker.
- O outbox do `document-processing-worker` nao mudou; a terminalizacao imediata ficou restrita ao `orchestrator-api`.
- A validacao executada nesta entrega cobriu `corepack pnpm typecheck` e as suites focadas de dominio, aplicacao e E2E da `orchestrator-api` para queue publication failure.

### Commit Contexts

- `bug(domain): registrar falha terminal de publicacao em fila`
- `bug(orchestrator): terminalizar falhas do outbox na publicacao`
- `test(orchestrator): cobrir falhas terminais de queue publication`
- `docs(changelog): documentar falha terminal de queue publication`

## [2026-03-28] - Hardening do parsing de x-role na orchestrator-api

## [2026-03-28] - Outbox transacional para publicacao de jobs

### Added

- Modelo compartilhado de `queue_publication_outbox` no `shared-kernel`, com lease, retry exponencial, retencao e metadados de finalizacao por fluxo.
- Dispatcher dedicado na `orchestrator-api` e no `document-processing-worker` para publicar `ProcessingJobRequestedMessage` a partir do outbox e finalizar `job`, `attempt` e auditoria apos confirmacao.
- Contexto operacional do job com bloco `queuePublication`, incluindo status do outbox, owner service, flow, dispatch kind, tentativas de publish e ultimo erro.
- Cobertura de dominio, aplicacao, contrato e E2E para `PUBLISH_PENDING`, envio assíncrono, replay assíncrono e retry do worker via outbox.

### Changed

- O lifecycle de `ProcessingJob` passou a seguir `STORED -> PUBLISH_PENDING -> QUEUED`, mantendo `AttemptStatus.PENDING` como estado persistido pre-publicacao.
- `SubmitDocumentUseCase`, `ReprocessDocumentUseCase` e `ReplayDeadLetterUseCase` passaram a aceitar o request de forma assíncrona, persistindo `job`, `attempt` e outbox na mesma transacao.
- O `ProcessingFailureRecoveryService` deixou de publicar retry diretamente no broker e passou a gravar a nova tentativa no outbox transacional do worker.
- `AttemptExecutionCoordinator` passou a tratar mensagens duplicadas ou tardias com compare-and-set por status, ignorando consumo que chegue apos o avancar do `job` ou `attempt`.
- `POST /v1/parsing/jobs`, `POST /v1/parsing/jobs/:jobId/reprocess` e `POST /v1/parsing/dead-letters/:dlqEventId/replay` passaram a retornar `202` quando o job fica em `PUBLISH_PENDING`.

### Fixed

- O sistema deixou de depender de publish síncrono seguido de persistencia, eliminando a janela em que a fila podia receber uma mensagem valida sem o estado correspondente no banco.
- Retries do worker deixaram de cair em DLQ espurio por falha intermediaria entre broker e persistencia do novo estado.
- O ambiente in-memory da `orchestrator-api` passou a publicar de forma deterministica nos testes, evitando corridas artificiais entre dispatcher e simulacao do worker.

### Technical Notes

- A colecao `queue_publication_outbox` ganhou indices para `outboxId`, `(ownerService,status,availableAt)`, `jobId`, `attemptId`, `leaseExpiresAt` e TTL de `retentionUntil`.
- O dispatcher usa `publishedAt` no instante real do publish; os use cases deixaram de preencher esse campo antes da confirmacao.
- O `GET /v1/parsing/jobs/:jobId` agora pode expor `PUBLISH_PENDING`, e o `GET /v1/ops/jobs/:jobId/context` passou a mostrar o estado do outbox mais recente por job.
- A validacao executada nesta entrega cobriu `npm run typecheck`, suites de dominio de lifecycle, suites de aplicacao do orchestrator e worker, contratos do publisher in-memory e o E2E de `document-jobs`.

### Commit Contexts

- `feat(shared-outbox-kernel)`
- `bug(shared-outbox-redaction)`
- `feat(domain-publish-pending)`
- `feat(orchestrator-outbox-contracts)`
- `feat(orchestrator-outbox-storage)`
- `feat(orchestrator-outbox-dispatcher)`
- `feat(orchestrator-async-publication)`
- `feat(orchestrator-replay-publication)`
- `feat(orchestrator-ops-outbox-visibility)`
- `bug(orchestrator-inmemory-dispatch)`
- `feat(worker-outbox-contracts)`
- `feat(worker-outbox-storage)`
- `feat(worker-outbox-dispatcher)`
- `feat(worker-retry-outbox)`
- `feat(outbox-regression-coverage)`
- `feat(worker-outbox-regression-coverage)`
- `bug(domain-publish-pending-coverage)`
- `docs(changelog)`

### Added

- Helper HTTP compartilhado para resolver `traceId` e `AuditActor` de forma consistente nos controllers da `orchestrator-api`.
- Cobertura E2E para `x-role` invalido nos endpoints de submit, replay de DLQ e leitura de contexto operacional.

### Changed

- `x-role` ausente continua assumindo `OWNER`, mas qualquer valor presente fora de `OWNER` e `OPERATOR` agora retorna `400 VALIDATION_ERROR`.
- Os controllers `DocumentJobsController`, `DeadLettersController` e `OperationalJobsController` passaram a usar a mesma regra centralizada de parsing de headers.
- `docs/ddd/04-result-delivery.md` foi realinhado ao contrato atual de `x-role`.

### Fixed

- Headers `x-role` com typo, casing diferente ou valor arbitrario deixaram de receber privilegio efetivo de `OWNER`.
- Respostas de erro por header invalido passaram a preservar `x-trace-id` para correlacao operacional.

### Technical Notes

- O RBAC do `SimpleRbacAuthorizationAdapter` nao mudou; o endurecimento ficou restrito a borda HTTP.
- O payload do erro de header invalido segue o envelope padrao com `errorCode`, `message` e `metadata`.
- A validacao desta entrega cobriu `corepack pnpm typecheck` e o filtro E2E `rejects invalid x-role`; a suite E2E completa segue bloqueada por falhas preexistentes fora deste escopo.

### Commit Contexts

- `bug(orchestrator-role-header)`
- `feat(orchestrator-http-context)`
- `test(orchestrator-e2e-role-header)`
- `docs(result-delivery)`

## [2026-03-28] - Hardening de integridade do contexto do worker

### Added

- Gate explicito de integridade no carregamento de contexto do worker para validar coerencia entre `message`, `job`, `document` e `attempt` antes de qualquer leitura de binario ou mutacao de estado.
- Novo erro fatal `InconsistentProcessingContextError` para distinguir mismatch relacional de ausencia de recurso no fluxo de DLQ de aplicacao.
- Cobertura adicional de aplicacao para mismatch entre `attempt.jobId` e `job.jobId`, divergencia entre `job.documentId` e `document.documentId` e retornos corrompidos de repositorio no `ProcessingContextLoader`.

### Changed

- `ProcessingFailureRecoveryService` passou a tratar falhas de integridade de contexto com quarentena conservadora, persistindo DLQ e auditoria a partir da mensagem quando o contexto carregado nao for confiavel para mutacao.
- Logs e metadados de falha do worker passaram a registrar `contextIssue`, `missingResources` e `mismatches` para facilitar auditoria operacional e investigacao de corrupcao cruzada.
- `RedactionPolicyService` passou a preservar `contextIssue` e detalhes de `mismatches` como metadados operacionais em auditoria, logs e snapshots de DLQ.

### Fixed

- O worker deixou de aceitar `attemptId`, `jobId` e `documentId` inconsistentes entre mensagem e repositorios no caminho feliz.
- Falhas de contexto divergente nao mutam mais `job` e `attempt` potencialmente estrangeiros durante o recovery fatal.
- O fluxo de observabilidade deixou de mascarar indevidamente a evidencia estrutural de mismatch relacional em DLQ e auditoria.

### Technical Notes

- `AttemptExecutionCoordinator` permaneceu sem guards extras; a protecao ficou centralizada no `ProcessingContextLoader`.
- A validacao executada nesta entrega foi `corepack pnpm test:application -- --runInBand --runTestsByPath apps/document-processing-worker/tests/application/process-job-message.use-case.spec.ts` seguida de `corepack pnpm typecheck`.

### Commit Contexts

- `bug(worker-context-integrity)`
- `feat(worker-context-observability)`
- `docs(changelog)`

## [2026-03-27] - Refinos do painel operacional e bootstrap local

### Added

- Cards de totais operacionais no painel HTML para `traceIds`, itens de timeline, tentativas, eventos de telemetria, artefatos e registros de DLQ.
- Resumo por servico na secao de telemetria do painel, separando contagens de `logs`, `metrics` e `spans` antes da lista detalhada.
- Scripts raiz `build:api`, `build:worker`, `dev:api` e `dev:worker` para compilar e subir os servicos diretamente do workspace.

### Changed

- A tabela de artefatos do painel passou a exibir `pageNumber` e `retentionUntil`, junto de um texto explicativo sobre a origem segura do preview.
- As suites de aplicacao e E2E da `orchestrator-api` passaram a cobrir previews redigidos de artefatos `LLM_PROMPT` e `LLM_RESPONSE`, incluindo mascaramento de `cpf`, `email` e tokens.
- Os atalhos de bootstrap local passaram a usar `corepack pnpm` para nao depender de uma instalacao global do `pnpm` no `PATH`.

### Fixed

- O painel deixou de tratar ausencia de `traceIds` e de telemetria como listas silenciosamente vazias; agora os estados sem dados ficam explicitos na interface.
- A cobertura operacional passou a proteger o painel HTML contra regressao que volte a expor `promptText`, `responseText` ou segredos em previews derivados.

### Technical Notes

- `dev:api` continua subindo a API em `memory` por default na porta `3000`; para fluxo distribuido completo ainda e necessario definir runtime `real` e iniciar o worker com a infraestrutura externa.
- O lockfile foi realinhado ao grafo atual de workspaces para manter os links locais coerentes com os manifests ja declarados no repositorio.

### Commit Contexts

- `feat(orchestrator-ops-panel)`
- `feat(dev-scripts)`
- `bug(lockfile)`
- `docs(changelog)`

## [2026-03-26] - Painel operacional e telemetria consultavel por job

### Added

- Read model `telemetry_events` para logs, metricas e spans correlacionados por `jobId`, `attemptId` e `traceId`, com implementacoes `in-memory` e `Mongo`.
- Fan-out de observabilidade no runtime da `orchestrator-api` e do `document-processing-worker`, preservando o sink atual e persistindo uma copia consultavel em Mongo no modo `real`.
- Endpoint interno `GET /v1/ops/jobs/{jobId}/context` e pagina HTML `GET /ops/jobs/{jobId}` para inspecao operacional manual por job.
- Query operacional na `orchestrator-api` para agregar `job`, `attempts`, `result`, `audit_events`, `dead_letter_events`, `page_artifacts`, `traceIds`, `timeline` e `telemetry_events`.
- Servico de preview redigido de artefatos, com `previewText` truncado para `OCR_JSON`, `MASKED_TEXT`, `LLM_PROMPT` e `LLM_RESPONSE`.
- Cobertura adicional de aplicacao, E2E e contratos reais para o painel operacional, fan-out de telemetria e indices TTL/correlacao de `telemetry_events`.
- Runner raiz `tooling/scripts/run-all-tests.cjs` para consolidar a execucao dos grupos de Jest e imprimir um resumo final unico.

### Changed

- `RetentionPolicyService` passou a definir retencao de `30 dias` para telemetria consultavel, e `RedactionPolicyService` ganhou mascaramento dedicado para previews de leitura.
- Casos de uso da `orchestrator-api` passaram a emitir correladores operacionais consistentes (`jobId`, `documentId`, `attemptId`, `operation`) em logs, metricas e spans.
- `ProcessJobMessageUseCase` e a pipeline OCR/LLM do worker passaram a abrir spans de stage para `context_load`, `attempt_start`, `extraction`, `success_persist`, `failure_recovery`, `page_extraction`, `fallback_resolution` e `outcome_assembly`.
- A leitura operacional da API passou a consultar `page_artifacts` e `telemetry_events` por filtros especificos, evitando `list()` global no caminho do painel.
- `README.md`, `docs/database-schemas.md` e `docs/ddd/06-audit-observability.md` foram realinhados ao estado real do painel operacional e da telemetria persistida.

### Fixed

- O MVP deixou de depender apenas de console ou exporter OTLP para inspecao operacional; agora a trilha por job fica consultavel no proprio produto.
- Artefatos operacionais deixaram de expor `rawText`, `rawPayload`, `promptText` e `responseText` no endpoint JSON e na pagina HTML.
- As suites reais de infraestrutura passaram a proteger a existencia das colecoes `page_artifacts` e `telemetry_events`, incluindo seus indices de TTL e correlacao.
- O script raiz de testes voltou a produzir um resumo consolidado dos grupos de Jest sem depender de encadeamento shell no `package.json`.

### Technical Notes

- O painel continua interno e reutiliza os mesmos limites de leitura do MVP; nao houve novo papel RBAC nesta fase.
- O fluxo distribuido continua centrado em `traceId` proprio, sem arvore completa de spans OpenTelemetry entre todos os hops.
- Os endpoints externos de parsing nao tiveram breaking change; a superficie nova ficou restrita aos caminhos `GET /v1/ops/jobs/{jobId}/context` e `GET /ops/jobs/{jobId}`.

### Commit Contexts

- `feat(shared-telemetry-fanout)`
- `feat(orchestrator-ops-contracts)`
- `feat(orchestrator-ops-http-contracts)`
- `feat(orchestrator-ops-query)`
- `feat(orchestrator-ops-runtime)`
- `feat(orchestrator-ops-mongo)`
- `bug(orchestrator-ops-instrumentation-a)`
- `bug(orchestrator-ops-instrumentation-b)`
- `feat(orchestrator-ops-tests)`
- `feat(worker-telemetry-contracts)`
- `feat(worker-telemetry-runtime)`
- `feat(worker-stage-instrumentation)`
- `feat(worker-pipeline-observability)`
- `feat(worker-telemetry-tests)`
- `feat(test-runner)`
- `docs(operational-panel)`
- `docs(changelog)`

## [2026-03-25] - Hardening operacional da fase 3

### Added

- Executor remoto comum para fallback LLM no worker, com timeout por request, concorrencia limitada, retry com backoff e degradacao por target quando o provider externo falha.
- Backend opcional de observabilidade via `OTLP/HTTP` no `shared-kernel`, preservando os adapters locais como fallback de runtime.
- Suite real de contratos do `document-processing-worker` com `testcontainers`, cobrindo sucesso ponta a ponta, retry, DLQ terminal e verificacao de indices TTL/operacionais.
- Novos testes de dominio para export `OTLP`, politicas de redacao e fallback de configuracao de observabilidade.

### Changed

- `OpenRouterLlmExtractionAdapter` e `HuggingFaceLlmExtractionAdapter` passaram a usar a mesma politica de execucao remota, respeitando `LLM_REQUEST_TIMEOUT_MS`, `LLM_MAX_CONCURRENCY`, `LLM_MAX_RETRIES` e `LLM_RETRY_BASE_DELAY_MS`.
- `RedactionPolicyService` foi endurecido para operar por contexto (`audit`, `log`, `dead_letter`, `artifact`) e para bloquear tanto chaves sensiveis quanto conteudo livre com email, telefone, `cpf`, `cnpj`, `cep` e tokens.
- Casos de uso e gravadores de auditoria da API e do worker passaram a persistir `metadata` saneado e `redactedPayload` coerente em auditoria, logs operacionais e snapshots de DLQ.
- O bootstrap de runtime dos dois servicos passou a aceitar `OBSERVABILITY_MODE=local|otlp`, com fallback automatico para o modo local quando a configuracao OTLP estiver ausente ou invalida.
- `README.md` e `docs/ddd/06-audit-observability.md` foram realinhados ao estado real do codigo apos a fase 3.

### Fixed

- O fallback LLM remoto deixou de depender de requests sem timeout e sem limite de paralelismo, reduzindo risco de travamento ou explosao de chamadas simultaneas.
- Logs, eventos de auditoria e payloads de falha passaram a bloquear persistencia acidental de texto bruto, prompt, resposta de LLM e identificadores sensiveis.
- O runtime de observabilidade passou a cair de volta com seguranca para os adapters locais quando o modo `otlp` estiver mal configurado.
- A cobertura de testes passou a proteger explicitamente retry transitorio, timeout, erro nao retryavel e export observavel para collector HTTP.

### Technical Notes

- A suite real do worker continua opt-in e so roda com `RUN_REAL_INFRA_TESTS=true`.
- O contrato HTTP dos endpoints e o payload principal de fila nao foram alterados nesta fase.
- Os gates executados ao final ficaram verdes com `lint`, `typecheck` e `test`.

### Commit Contexts

- `feat(worker-remote-llm-runtime)`
- `feat(worker-remote-llm-providers)`
- `feat(shared-operational-observability)`
- `bug(worker-operational-redaction)`
- `feat(runtime-observability-bootstrap)`
- `bug(orchestrator-audit-redaction)`
- `feat(orchestrator-operational-hardening)`
- `feat(orchestrator-observability-tests)`
- `feat(worker-real-infra-tests)`
- `docs(operational-hardening)`

## [2026-03-25] - Simplificacao estrutural do orchestrator e worker

### Added

- Novos servicos comuns na `orchestrator-api` para auditoria, tratamento de falha de publicacao e orquestracao de jobs derivados.
- Novos servicos de aplicacao no worker para carregar contexto, iniciar tentativas, persistir sucesso e concentrar recovery de retry e DLQ.
- Novos estagios internos da pipeline OCR/LLM para extracao por pagina, resolucao de fallback, montagem de artifacts e assembly do `ProcessingOutcome`.
- Cobertura dedicada para `ProcessingSuccessPersister`, `ProcessingFailureRecoveryService` e para os novos estagios internos da pipeline.

### Changed

- `SubmitDocumentUseCase`, `ReprocessDocumentUseCase` e `ReplayDeadLetterUseCase` foram reduzidos para coordenacao de fluxo, validacao, logs e metricas, reaproveitando servicos comuns sem alterar contratos externos.
- `ProcessJobMessageUseCase` passou a atuar como coordenador fino de tracing, metricas e logs, delegando lifecycle, retry, DLQ e persistencia para servicos especializados.
- `OcrLlmExtractionPipelineAdapter` passou a apenas orquestrar estagios internos, mantendo `ExtractionPipelinePort.extract(...)` e o comportamento externo do worker.
- `RetentionPolicyService` e testes auxiliares foram ajustados para reforcar tipos canonicos e eliminar problemas residuais de lint.

### Fixed

- Falhas de lint restantes em imports de tipo, enum comparison, `any` em teste e serializacao de mock `fetch`.
- Duplicacao operacional entre orchestrator e worker na gravacao de auditoria, persistencia de sucesso e tratamento de falha de publicacao.
- Divergencia de lifecycle causada por entidades locais redundantes, agora removidas em favor do pacote `@document-parser/document-processing-domain`.

### Technical Notes

- Endpoints HTTP, DTOs externos, contratos de fila e o shape de `ProcessingJobRequestedMessage` permaneceram inalterados.
- Os fluxos de `submit`, `reprocess`, `replay`, retry e DLQ foram preservados semanticamente; a mudanca desta fase foi estrutural.
- Os quatro gates de raiz fecharam verdes ao final da fase: `lint`, `typecheck`, `build` e `test`.

### Commit Contexts

- `feat(orchestrator-common-services)`
- `feat(orchestrator-structural-refactor)`
- `bug(orchestrator-cleanup-tests)`
- `feat(worker-processing-services-a)`
- `feat(worker-processing-services-b)`
- `bug(worker-usecase-cleanup)`
- `feat(worker-processing-tests)`
- `feat(worker-pipeline-stages-a)`
- `feat(worker-pipeline-stages-b)`
- `bug(worker-pipeline-contracts)`
- `bug(worker-pipeline-golden)`
- `bug(shared-lint-retention)`
- `docs(changelog)`

## [2026-03-25] - Corretude de resultados, reuso deduplicado e DLQ de contexto

### Added

- Cobertura nova para a invariante de um unico `ProcessingResult` por `jobId` em adapters `in-memory`, contratos Mongo e fluxo de aplicacao da API.
- Novos cenarios de aplicacao do worker para contexto incompleto, cobrindo `dead_letter_events`, auditoria `PROCESSING_FAILED` e fechamento terminal quando `job` e `attempt` existem.
- Testes de dominio e contrato para o novo mascaramento reversivel do fallback LLM com placeholders por categoria.

### Changed

- Repositorios de `ProcessingResult` na API e no worker passaram a tratar `jobId` como chave logica de escrita, mantendo `resultId` como identificador estavel e adicionando unicidade Mongo por `processing_results.jobId`.
- O reuso deduplicado da `orchestrator-api` passou a copiar `promptVersion`, `modelVersion` e `normalizationVersion`, e a aplicar a mesma regra de lineage em `ProcessingJob` e `ProcessingResult`.
- O `SensitiveDataMaskingService` passou a gerar `maskedText + placeholderMap`, preservando semantica numerica e restaurando placeholders no texto consolidado antes da persistencia do resultado final.
- O worker passou a tratar contexto ausente antes do `startPendingAttempt`, roteando falhas observaveis para o fluxo de DLQ de aplicacao sem alterar o comportamento do listener frente a `nack(false, false)`.

### Fixed

- `ProcessingResult` duplicado para o mesmo job deixou de ser possivel pelos adapters padrao do projeto.
- Reuso em cadeia de resultado compativel nao perde mais `sourceJobId` original nem os version stamps tecnicos do resultado reutilizado.
- O fallback LLM deixou de destruir datas, doses, idades e outros numeros nao sensiveis ao mascarar texto para providers externos.
- Falhas de contexto do worker agora deixam trilha em `dead_letter_events` e auditoria de aplicacao, em vez de escaparem apenas para a DLQ do broker.

### Technical Notes

- O contrato HTTP e o payload RabbitMQ permaneceram inalterados nesta fase.
- A restauracao de placeholders acontece apenas no payload consolidado e no `ProcessingResult`; artefatos tecnicos de `MASKED_TEXT`, prompt e resposta continuam mascarados.
- O indice unico em `processing_results.jobId` pressupoe ausencia de duplicatas legadas no banco antes do rollout.

### Commit Contexts

- `bug(orchestrator-result-contracts)`
- `bug(orchestrator-result-repository)`
- `bug(orchestrator-result-infra-tests)`
- `bug(worker-result-repository)`
- `bug(worker-llm-masking)`
- `bug(worker-context-dlq)`
- `bug(worker-llm-contracts)`
- `bug(worker-llm-domain)`
- `docs(changelog)`

## [2026-03-25] - Audit/Observability com traceId, TTL e replay manual de DLQ

### Added

- Base vendor-agnostic de observabilidade no `shared-kernel`, com `LoggingPort`, `MetricsPort`, `TracingPort`, adapters JSON para runtime e adapters em memoria para testes.
- Politicas canonicas de `redaction` e `retention` para proteger logs, `redactedPayload` e colecoes observaveis sem vazar `rawText`, `rawPayload`, `promptText`, `responseText` ou binarios.
- Correlacao ponta a ponta por `traceId`, da entrada HTTP (`x-trace-id`) ate o payload da fila e o processamento do worker.
- Novo endpoint owner-only `POST /v1/parsing/dead-letters/:dlqEventId/replay` para replay manual de DLQ com criacao de novo job de reprocessamento.

### Changed

- `AuditEventRecord`, `DeadLetterRecord`, `ProcessingResultRecord` e `PageArtifactRecord` passaram a carregar metadados de agregacao, `traceId`, `retentionUntil` e, quando aplicavel, `replayedAt`.
- `SubmitDocumentUseCase`, `GetJobStatusUseCase`, `GetProcessingResultUseCase`, `ReprocessDocumentUseCase` e `ProcessJobMessageUseCase` passaram a emitir spans, logs estruturados, metricas e auditoria com payload redigido.
- `GET /v1/parsing/jobs/:jobId` agora registra `JOB_STATUS_QUERIED`, e os adapters Mongo criam TTL indexes para `audit_events`, `dead_letter_events`, `processing_results` e `page_artifacts`.
- `ReplayDeadLetterUseCase` marca `dead_letter_events.replayedAt` apenas apos publish bem-sucedido e registra `DEAD_LETTER_REPLAY_FAILED` quando o replay falha.

### Fixed

- O worker e a API deixaram de perder a correlacao operacional entre HTTP, fila, auditoria e DLQ durante retries, falhas terminais e reprocessamentos.
- Logs e eventos observaveis agora bloqueiam persistencia acidental de texto bruto de OCR, prompts, respostas de LLM e outros payloads sensiveis.
- A estrategia de retencao passou a ser canonica entre API e worker, evitando expiracao inconsistente entre resultados, artefatos e auditoria.

### Technical Notes

- O shape JSON dos endpoints de jobs e resultados foi preservado; a unica mudanca externa no fluxo existente foi o header `x-trace-id`.
- O replay manual nao reabre o job falhado: ele cria um novo job com novo `jobId`, novo `attemptId`, `attemptNumber = 1` e `reprocessOfJobId` apontando para o job original.
- Registros legados sem `retentionUntil` continuam legiveis; a expiracao automatica passa a valer apenas para os dados persistidos com o novo contrato.

### Commit Contexts

- `feat(shared-observability-core)`
- `feat(shared-observability-contracts)`
- `feat(document-domain-observability)`
- `feat(orchestrator-observability-contracts)`
- `feat(orchestrator-observability-infra)`
- `feat(orchestrator-observability-http)`
- `feat(orchestrator-observability-jobs)`
- `feat(orchestrator-observability-results)`
- `feat(worker-observability-contracts)`
- `bug(worker-observability-runtime)`
- `feat(worker-observability-repositories)`
- `feat(orchestrator-observability-tests-a)`
- `feat(orchestrator-observability-tests-b)`
- `bug(observability-lifecycle-tests)`
- `feat(worker-observability-tests)`
- `docs(changelog)`

## [2026-03-25] - Guardrails de template e alinhamento documental do MVP

### Added

- Novos guardrails de teste na `orchestrator-api` para garantir que contratos HTTP, mensagens de fila e adapters continuem sem `templateId`, `templateVersion`, `templateStatus` e `matchingRules` enquanto `Template Management` permanecer inativo.
- Novo teste de guardrail arquitetural para verificar que contratos, schemas e codigo runtime do MVP continuam livres de colecoes e comandos de template, preservando `compatibilityKey` como unica chave de reaproveitamento.

### Changed

- `CompatibilityKey` e os testes de submissao e reutilizacao foram reforcados para deixar explicito que o reaproveitamento compativel depende apenas de `hash`, `requestedMode`, `pipelineVersion` e `outputVersion`.
- Os testes de heuristica do worker passaram a afirmar que `checkboxFindings` e `criticalFieldFindings` continuam sendo pistas internas de fallback, e nao metadados administrativos de template.
- `docs/database-schemas.md`, `docs/ddd/04-result-delivery.md`, `docs/ddd/05-template-management.md` e `docs/ddd/06-audit-observability.md` foram realinhados ao estado atual do codigo e aos limites reais do MVP.

### Fixed

- A documentacao deixou de insinuar `ProcessingResult` com `FAILED`, colecoes de template no schema do MVP e uma stack de observabilidade completa ja implementada no repositorio.
- A suite de testes agora protege explicitamente o contrato minimo de status, resultado e fila contra vazamento acidental de campos de template.

### Technical Notes

- `processing_results` continua indexado por `compatibilityKey` para deduplicacao e nao por qualquer identificador de template.
- `Template Management` segue documentado como contexto futuro, sem impacto no runtime atual de `orchestrator-api` e `document-processing-worker`.

### Commit Contexts

- `bug(worker-heuristics)`
- `bug(orchestrator-compatibility)`
- `feat(orchestrator-template-guardrails)`
- `feat(orchestrator-contract-guardrails)`
- `docs(result-delivery)`
- `docs(template-observability)`

## [2026-03-25] - Result Delivery MVP endurecido na orchestrator-api

### Added

- Suite dedicada de aplicacao para `GetJobStatusUseCase` e `GetProcessingResultUseCase`, cobrindo RBAC de leitura, `NOT_FOUND`, `PARTIAL`, `reusedResult` e auditoria `RESULT_QUERIED`.
- Cobertura adicional de aplicacao para `ReprocessDocumentUseCase`, incluindo validacao de `reason`, job inexistente, restricao para `OPERATOR` e verificacao do novo `JobAttempt`.
- Novos cenarios E2E para o envelope HTTP de erro, defaults de `x-actor-id` e `x-role` e reprocessamento bem-sucedido sem sobrescrever o historico anterior.

### Changed

- O contrato interno HTTP da API passou a declarar explicitamente `HttpErrorResponse` com `errorCode`, `message` e `metadata?`, preservando o wire format ja exposto.

### Fixed

- `DocumentJobsController` passou a montar respostas de erro por um unico caminho tipado para `VALIDATION_ERROR`, `NOT_FOUND`, `AUTHORIZATION_ERROR` e falhas inesperadas.

### Technical Notes

- Nenhum endpoint novo foi introduzido e os contratos `JobResponse` e `ResultResponse` permaneceram minimos.
- `GET /result` continua retornando `404 NOT_FOUND` quando o job existe mas ainda nao ha `ProcessingResult` persistido, inclusive para jobs `FAILED`.

### Commit Contexts

- `bug(orchestrator-http)`
- `feat(orchestrator-tests-application)`
- `feat(orchestrator-tests-e2e)`
- `docs(changelog)`

## [2026-03-25] - OCR/LLM Extraction MVP no worker

### Added

- Taxonomias canonicas de `ExtractionWarning` e `FallbackReason`, alem dos novos artefatos tecnicos `LLM_PROMPT` e `LLM_RESPONSE`.
- Tipos internos do contexto de extracao para `PageExtraction`, `FallbackTarget`, `TargetLocator`, classificacao de manuscrito e estado de checkbox.
- Pipeline real no `document-processing-worker` com etapas nomeadas de renderizacao, OCR, normalizacao, heuristicas, mascaramento, fallback por alvo, consolidacao e `ProcessingOutcome`.
- Adapters internos deterministas para renderizacao por pagina, OCR e fallback LLM local, com suporte configuravel a providers externos via `OpenRouter` e `HuggingFace`.
- Cobertura nova de dominio, aplicacao, contrato e golden dataset para o fluxo OCR/LLM do worker.

### Changed

- `DocumentProcessingWorkerModule` passou a usar a pipeline real por padrao, mantendo o adapter simulado apenas para cenarios controlados.
- `ProcessingOutcomePolicy`, `ProcessingResult` e fechamento de `JobAttempt` passaram a refletir a taxonomia oficial de warnings, `fallbackReason` e os marcadores textuais canonicos do MVP.
- Os testes do worker e o E2E da API foram alinhados ao marcador textual `[ilegivel]` e aos novos contratos canonicos da extracao.

### Fixed

- Fallbacks de pagina ou documento inteiro nao ocultam warnings de alvos locais quando a recuperacao global realmente substitui o texto base.
- A consolidacao de checkbox ambiguo nao corrompe mais o marcador original antes da etapa de heuristica.
- Conteudo ilegivel puro deixa de disparar fallback global indevido quando ainda existe payload OCR utilizavel para classificar o resultado como `PARTIAL`.

### Commit Contexts

- `feat(shared-kernel)`
- `feat(document-domain)`
- `feat(worker-extraction-domain)`
- `feat(worker-extraction-services)`
- `feat(worker-extraction-adapters)`
- `feat(worker-llm-providers)`
- `feat(worker-pipeline)`
- `bug(worker-policy)`
- `feat(worker-tests-domain)`
- `feat(worker-tests-contracts-a)`
- `feat(worker-tests-contracts-b)`
- `feat(worker-tests-flow)`
- `bug(orchestrator-e2e)`
- `docs(ocr-llm-extraction)`

## [2026-03-25] - Refinamento do DDD de OCR/LLM Extraction

### Changed

- `docs/ddd/03-ocr-llm-extraction.md` foi reestruturado para explicitar fronteiras com `Ingestion` e `Document Processing`, alinhar a extracao ao modelo canonico de `JobAttempt` e `ProcessingOutcome`, formalizar a linguagem ubiqua operacional e documentar o estado atual do worker contra o desenho alvo.

### Commit Contexts

- `docs(ddd)`

## [2026-03-25] - Document Processing com lifecycle compartilhado, retry por TTL e DLQ

### Added

- Novo pacote `document-processing-domain` com modelos canonicos de `ProcessingJob`, `JobAttempt`, `ProcessingResult` e `DeadLetterRecord`.
- Maquinas de estado puras e servicos compartilhados para lifecycle, classificacao de falha, versionamento tecnico e politica de retry.
- Novos estados oficiais de tentativa: `PENDING`, `PARTIAL`, `TIMED_OUT` e `MOVED_TO_DLQ`.
- Topologia RabbitMQ com fila principal, filas de retry por TTL e fila de DLQ derivadas da fila base.
- `UnitOfWorkPort` e implementacoes `in-memory` e `Mongo` no worker.
- Nova cobertura de dominio para lifecycle de job e attempt, alem de contract tests de retry e DLQ no publisher.

### Changed

- `SubmitDocumentUseCase` e `ReprocessDocumentUseCase` agora persistem o primeiro `JobAttempt` como `PENDING` antes do publish e so promovem para `QUEUED` apos confirmacao.
- `ProcessJobMessageUseCase` passou a usar o lifecycle compartilhado para `PROCESSING`, `COMPLETED`, `PARTIAL`, retry e `MOVED_TO_DLQ`.
- API e worker deixaram de manter `ProcessingJobRecord` e `JobAttemptRecord` em duplicidade local; ambos consomem o mesmo shape do pacote compartilhado.
- Os adapters de fila passaram a expor `publishRequested` e `publishRetry`, escondendo nomes de filas dos casos de uso.

### Fixed

- Falha de publicacao inicial em fila agora preserva `JobAttempt` em `PENDING` em vez de perder o `attemptId`.
- Reuso de resultado compativel foi alinhado ao novo modelo, no qual `ProcessingResult` terminal so existe para `COMPLETED` e `PARTIAL`.
- Falha ao agendar retry no worker agora fecha o job em `FAILED`, registra `DeadLetterRecord` e encaminha a mensagem para a DLQ operacional.

### Technical Notes

- O payload minimo da fila permaneceu inalterado: `documentId`, `jobId`, `attemptId`, `requestedMode`, `pipelineVersion` e `publishedAt`.
- As filas derivadas seguem o padrao `${main}.retry.1`, `${main}.retry.2`, `${main}.retry.3` e `${main}.dlq`.
- Os testes de infraestrutura real continuam protegidos por `RUN_REAL_INFRA_TESTS=true`.

### Commit Contexts

- `feat(shared-kernel)`
- `feat(document-domain-base)`
- `feat(document-domain-lifecycle)`
- `feat(document-domain-versioning)`
- `feat(workspace-domain)`
- `feat(testkit)`
- `feat(orchestrator-setup)`
- `feat(orchestrator-contracts)`
- `feat(orchestrator-usecases)`
- `bug(orchestrator-compatibility)`
- `feat(orchestrator-contract-tests)`
- `feat(worker-setup)`
- `feat(worker-contracts)`
- `feat(worker-infra)`
- `feat(worker-runtime)`
- `feat(worker-lifecycle)`
- `docs(changelog)`

## [2026-03-25] - Ingestion MVP com infraestrutura real e compatibilidade por chave

### Added

- `ingestionTransitions` nos `ProcessingJobRecord` da API e do worker para registrar `RECEIVED`, `VALIDATED`, `STORED`, `DEDUPLICATED`, `REPROCESSED` e `QUEUED`.
- `compatibilityKey` nos `ProcessingResultRecord` para lookup do resultado compativel mais recente.
- `CompatibleResultLookupPort`, `UnitOfWorkPort` e `BinaryStoragePort.delete` no `orchestrator-api`.
- `PageCountPolicy` e `DocumentStoragePolicy` para fechar as regras de contagem de paginas e persistencia canonica.
- Adapters reais de `MongoDB`, `MinIO` e `RabbitMQ` no `orchestrator-api`.
- Adapters reais de `MongoDB`, `MinIO` e `RabbitMQ` no `document-processing-worker`.
- Bootstrap por `process.env` para os dois servicos, com `memory` como modo padrao e `real` como modo de infraestrutura externa.
- Contract tests reais com `testcontainers` para a infraestrutura do `orchestrator-api`, protegidos por `RUN_REAL_INFRA_TESTS=true`.
- Nova cobertura de dominio para as politicas de ingestao e ampliacao da cobertura de aplicacao para falha de publish, deduplicacao e compensacao de upload.

### Changed

- `SubmitDocumentUseCase` foi refatorado para um fluxo nomeado e em duas etapas: persistencia transacional, publish e so depois criacao do primeiro `JobAttempt`.
- `ReprocessDocumentUseCase` foi alinhado ao mesmo padrao de persistir antes, publicar depois e criar `JobAttempt` apenas apos publish bem-sucedido.
- O worker passou a persistir `compatibilityKey` ao gravar `ProcessingResult`.
- O publisher em memoria da API passou a simular melhor a semantica assincrona da fila, e os E2E foram ajustados para polling de status.
- `OrchestratorApiModule` e `DocumentProcessingWorkerModule` foram preparados para os novos contratos e adapters.

### Fixed

- Reuso de resultado agora ignora `FAILED`.
- Falha de publicacao em fila deixa o job persistido com erro transitorio e sem `JobAttempt`.
- Falha na primeira transacao apos upload remove o binario recem-gravado do storage.
- O worker e os testes foram atualizados para o novo shape compartilhado de `ProcessingJobRecord` e `ProcessingResultRecord`.

### Technical Notes

- O runtime real exige `MONGODB_URI`, `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET_ORIGINALS`, `RABBITMQ_URL` e `RABBITMQ_QUEUE_PROCESSING_REQUESTED`.
- O `ProcessingJob.status` de jobs deduplicados continua terminal em `COMPLETED` ou `PARTIAL`; `DEDUPLICATED` fica registrado em `ingestionTransitions`.
- Os contract tests reais ficaram `skip` por padrao para nao exigir Docker em toda execucao local.

### Commit Contexts

- `feat(deps)`
- `bug(lockfile)`
- `feat(orchestrator-contracts)`
- `feat(worker-contracts)`
- `feat(orchestrator-domain)`
- `feat(orchestrator-jobs)`
- `feat(orchestrator-usecase)`
- `bug(orchestrator-queue)`
- `feat(orchestrator-runtime)`
- `feat(orchestrator-bootstrap)`
- `feat(orchestrator-tests)`
- `feat(worker-runtime)`
- `feat(worker-queue)`
- `feat(worker-bootstrap)`
- `feat(worker-tests)`
- `docs(ingestion)`

## [2026-03-25] - Base inicial do MVP

### Added

- Monorepo `pnpm` com workspace raiz, configuracoes compartilhadas de TypeScript, ESLint e Jest.
- Pacote `shared-kernel` com enums, constantes, erros e contratos tecnicos compartilhados.
- Pacote `testkit` com builders, fakes, helpers e harness para sustentar a estrategia TDD.
- App `orchestrator-api` em `NestJS` com estrutura hexagonal, contratos, dominio, casos de uso, adapters e bootstrap HTTP.
- App `document-processing-worker` em `NestJS` com estrutura hexagonal, consumo de fila, pipeline simulada, retries e DLQ em memoria.
- Suites de teste separadas em `domain`, `application`, `contracts` e `e2e` para os dois servicos.

### Changed

- `README.md` foi alinhado ao context map do MVP e ao contrato externo minimo.
- `docs/ddd/04-result-delivery.md` foi ajustado para refletir `payload` textual e RBAC simples `OWNER` e `OPERATOR`.
- `docs/database-schemas.md` foi reduzido ao escopo real do MVP, removendo `Template Management` do schema publico.
- `docs/plano-implementacao.md` foi atualizado para refletir a base tecnica efetivamente implementada.

### Fixed

- Configuracao raiz de lint, typecheck e testes foi estabilizada para o workspace atual.
- `.gitignore` passou a ignorar artefatos de build e `*.tsbuildinfo`.

### Technical Notes

- O contrato externo atual do MVP expoe apenas `jobId`, `documentId`, `status`, `requestedMode`, `pipelineVersion`, `outputVersion`, `confidence`, `warnings` e `payload`.
- O runtime padrao desta base usa adapters em memoria para storage, repositorios e fila, preservando o ciclo TDD antes da troca por infraestrutura real.
- O banco compartilhado entre API e worker continua sendo uma decisao do MVP, mas cada servico mantem seu proprio hexagono.

### Commit Contexts

- `feat(workspace)`
- `bug(tooling)`
- `feat(testing)`
- `feat(shared-kernel)`
- `feat(testkit)`
- `feat(orchestrator)`
- `feat(orchestrator-domain)`
- `feat(orchestrator-app)`
- `feat(orchestrator-adapters)`
- `feat(orchestrator-http)`
- `feat(orchestrator-tests)`
- `feat(worker)`
- `feat(worker-domain)`
- `feat(worker-app)`
- `feat(worker-adapters)`
- `feat(worker-bootstrap)`
- `feat(worker-tests)`
- `docs(readme)`
- `docs(ddd)`
- `docs(data)`
- `docs(plan)`
