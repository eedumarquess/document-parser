# AGENTS

## Projeto

Monorepo `pnpm` em `TypeScript` com dois servicos `NestJS`:

- `apps/orchestrator-api`: recebe upload, valida documento, persiste, cria/reaproveita jobs, expoe status, resultado, contexto operacional e replay/reprocessamento.
- `apps/document-processing-worker`: consome fila, renderiza paginas, executa OCR, aplica heuristicas/fallback LLM e persiste resultado/artefatos.

Infra principal no modo `real`: `MongoDB`, `RabbitMQ` e `MinIO`.
Modo padrao local: `memory`.

## Workspaces

- `packages/shared-kernel`: enums, erros, tipos, observabilidade, redaction, retention e contratos tecnicos transversais.
- `packages/document-processing-domain`: lifecycle de `job/attempt/result`, retry, version stamps e `CompatibilityKey`.
- `packages/shared-infrastructure`: adapters e utilitarios tecnicos compartilhados (`Mongo`, `RabbitMQ`, clock, wrappers nativos de `pdfinfo`, `pdftoppm` e `tesseract`).
- `packages/testkit`: builders, fakes, harness e fixtures de teste.

Regra pratica: novas regras especificas de um app ficam no app. So extraia para `packages/*` quando a regra ja for canonica e realmente compartilhada.

## Estrutura e limites

- Cada app segue hexagonal: `domain`, `application`, `adapters`, `contracts`.
- `adapters/in` so traduzem entrada para `command/query/use case`.
- `adapters/out` falam com storage, fila, banco, OCR, LLM e clock.
- Os testes ficam separados por camada: `domain`, `application`, `contracts` e `e2e`.

## Invariantes importantes

- O fluxo assincrono usa `queue_publication_outbox`. Na API, jobs aceitos passam por `PUBLISH_PENDING` antes de `QUEUED`; nao publique direto do use case.
- `x-role` aceita apenas `OWNER` e `OPERATOR`. Header ausente assume `OWNER`. Qualquer outro valor deve retornar `400 VALIDATION_ERROR`.
- `CompatibilityKey` define reaproveitamento compativel. Nao duplique essa regra fora de `packages/document-processing-domain`.
- `ProcessingResult` persistido e terminal so para `COMPLETED` ou `PARTIAL`.
- `PDF` nao deve ser tratado como texto UTF-8. A API conta paginas com `pdfinfo`; o worker renderiza com `pdftoppm` e faz OCR com `tesseract`.
- Nao reintroduza regex em buffer cru para contar paginas nem fallback textual em bytes de `PDF`.
- O contexto operacional nao deve expor `rawText`, `rawPayload`, `promptText` ou `responseText` crus. `previewText` precisa continuar redigido e seguro contra lixo binario.

## Comandos uteis

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:domain
corepack pnpm test:application
corepack pnpm test:contracts
corepack pnpm test:e2e
```

Bootstrap local no Windows:

```powershell
.\start-dev.ps1
```

Isso sobe a infra local via `docker-compose.local.yml` e abre API + worker em watch mode. A API fica em `http://localhost:3000`.

Flags uteis:

- `RUN_REAL_INFRA_TESTS=true`: habilita testes reais com `testcontainers`.
- `RUN_NATIVE_PDF_TESTS=true`: habilita smoke do caminho nativo de PDF.

## Documentacao para consultar primeiro

- `README.md`: visao geral, runtime e comandos.
- `docs/changelog.md`: historico tecnico real do que mudou.
- `docs/database-schemas.md`: colecoes e read models.
- `docs/ddd/`: contexto e fronteiras por subdominio.
- `docs/contexto-problema-pdf-real.md`: contexto do bug real de PDF e criterio de sucesso da correcao.
- `docs/relatorio-logica-duplicacoes.md`: riscos e duplicacoes ja analisados.

## Ao editar

- Leia `docs/changelog.md` antes de mexer em fluxos centrais.
- Atualize `docs/changelog.md` quando houver mudanca relevante de comportamento, arquitetura ou operacao.
- Prefira testes focados na camada alterada antes da suite completa.
- Nao assuma worktree limpo; confira `git status --short --branch` antes de editar.
