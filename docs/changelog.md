# Changelog

Todas as mudancas relevantes deste repositorio devem ser registradas aqui.

O formato segue uma adaptacao simples de `Keep a Changelog` e usa as tags de contexto dos commits como apoio para rastreabilidade.

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
