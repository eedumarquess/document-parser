# Document Parser

Parser documental assincrono para ficha clinica, com foco em reduzir digitacao manual e devolver texto consolidado com marcacoes semanticas.

## Quick Start de 5 minutos

### Pre-requisitos minimos

- `Node.js 22`
- `corepack`
- `Docker Desktop`
- `PowerShell` no Windows

### Suba o ambiente local recomendado

O caminho recomendado para uso humano local e sempre o runtime `real`, usando `.\start-dev.ps1`.

```powershell
corepack enable
corepack pnpm install
Copy-Item .env.example .env
.\start-dev.ps1
```

O script:

- sobe `MongoDB`, `RabbitMQ` e `MinIO` com `docker-compose.local.yml`
- inicializa a infra local necessaria para o fluxo real
- abre duas janelas do PowerShell, uma para a API e outra para o worker

### Rode um smoke local

Sem informar arquivo, o smoke usa o fixture PDF do proprio repositorio:

```powershell
corepack pnpm smoke:local
```

Para testar com um arquivo seu:

```powershell
corepack pnpm smoke:local -- -FilePath C:\caminho\arquivo.pdf
```

Opcoes uteis:

- `-BaseUrl http://localhost:3000`
- `-TimeoutSeconds 45`
- `-PollIntervalSeconds 2`

O smoke faz:

1. `GET /health`
2. `POST /v1/parsing/jobs`
3. polling em `GET /v1/parsing/jobs/{jobId}`
4. `GET /v1/parsing/jobs/{jobId}/result`

### Endpoints e UIs uteis

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs-json`
- Health: `http://localhost:3000/health`
- RabbitMQ UI: `http://localhost:15672`
- MinIO Console: `http://localhost:9001`

### Verifique o gate principal

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:domain
corepack pnpm test:application
corepack pnpm test:e2e
corepack pnpm build
```

## O que o sistema faz

O MVP processa documentos enviados via `multipart/form-data`, armazena o arquivo bruto, cria um job assincrono e delega o processamento a um worker especializado. O resultado final e persistido e exposto por uma API orientada a jobs.

O contrato externo minimo do fluxo principal contem:

- `jobId`
- `documentId`
- `status`
- `requestedMode`
- `pipelineVersion`
- `outputVersion`
- `confidence`
- `warnings`
- `payload`

### Entrada

- Upload via `multipart/form-data`
- Limite de ate 10 paginas
- Tamanho maximo de 50 MB
- Tipos aceitos: `application/pdf`, `image/jpeg`, `image/png`

### Saida

- Texto unico concatenado com marcacoes semanticas
- Marcador explicito `[ilegivel]` quando aplicavel
- Idioma otimizado para `pt-BR`
- Metadados minimos de execucao

## Visao geral da arquitetura

### Servicos

1. `apps/orchestrator-api`
   Recebe upload, valida documento, persiste, cria ou reaproveita jobs, expoe status, resultado, reprocessamento e leitura operacional.

2. `apps/document-processing-worker`
   Consome fila, renderiza paginas, executa OCR, aplica heuristicas, usa fallback LLM quando necessario e persiste resultado e artefatos.

### Infraestrutura do modo real

- `MongoDB`: metadados, jobs, resultados, artefatos, auditoria e read models operacionais
- `RabbitMQ`: fila principal, retry e DLQ
- `MinIO`: arquivo original e artefatos derivados
- `OpenTelemetry` ou adapters locais: metricas, logs estruturados e traces

### Fluxo ponta a ponta

1. Cliente envia arquivo para `POST /v1/parsing/jobs`
2. API valida MIME, tamanho, numero de paginas e hash
3. Arquivo bruto e salvo no storage
4. API registra documento, job e outbox transacional
5. Dispatcher publica a mensagem na fila
6. Worker executa OCR, heuristicas e fallback LLM quando necessario
7. Resultado consolidado e persistido
8. Cliente consulta status e resultado por `jobId`

### Estrutura do monorepo

- `apps/orchestrator-api`: borda HTTP e orquestracao de jobs
- `apps/document-processing-worker`: pipeline de processamento
- `packages/shared-kernel`: enums, erros, observabilidade, redaction e contratos transversais
- `packages/document-processing-domain`: lifecycle de `job`, `attempt` e `result`, retry e `CompatibilityKey`
- `packages/shared-infrastructure`: bootstrap de runtime, `Mongo`, `RabbitMQ` e wrappers nativos de `pdfinfo`, `pdftoppm` e `tesseract`
- `packages/testkit`: builders, fakes, fixtures e harness de teste

## Endpoints principais

- `POST /v1/parsing/jobs`
- `GET /v1/parsing/jobs/{jobId}`
- `GET /v1/parsing/jobs/{jobId}/result`
- `POST /v1/parsing/jobs/{jobId}/reprocess`
- `GET /health`

## Avancado

### Runtime

- Uso humano local recomendado: `.\start-dev.ps1` com runtime `real`
- `memory` continua suportado, mas e um caminho interno de teste e suites automatizadas
- `dev:api` e `dev:worker` isolados sao uteis para desenvolvimento controlado, nao para o onboarding principal

### Headers avancados

Os headers abaixo existem e aparecem no Swagger, mas nao sao necessarios para o onboarding inicial:

- `x-role`
- `x-trace-id`
- `x-actor-id`

Regras relevantes:

- header ausente de `x-role` assume `OWNER`
- `x-role` so aceita `OWNER` ou `OPERATOR`
- qualquer outro valor retorna `400 VALIDATION_ERROR`

### Operacao e suporte

Estas rotas continuam disponiveis, mas ficam fora do caminho inicial de uso:

- `GET /v1/ops/jobs/{jobId}/context`
- `GET /ops/jobs/{jobId}`
- `POST /v1/parsing/dead-letters/{dlqEventId}/replay`

O contexto operacional agrega `summary`, `attempts`, `result`, `auditEvents`, `deadLetters`, `artifacts`, `traceIds` e `timeline`, sempre com payloads sensiveis redigidos.

### Endpoint dev-only submit-and-wait

Existe um atalho opcional de DX para debugging e onboarding rapido:

- `POST /v1/dev/parsing/jobs/submit-and-wait`

Ele so existe quando:

```powershell
$env:ENABLE_DEV_CONVENIENCE_ENDPOINTS='true'
```

Flags relacionadas:

- `ENABLE_DEV_CONVENIENCE_ENDPOINTS`
- `DEV_CONVENIENCE_TIMEOUT_MS`
- `DEV_CONVENIENCE_POLL_INTERVAL_MS`

Esse endpoint nao bypassa outbox, fila, worker nem persistencia. Ele apenas submete o job e faz polling interno ate chegar em estado terminal ou timeout.

### Rodar sem Docker

Se voce realmente quiser subir manualmente sem `.\start-dev.ps1`:

1. instale `Node.js 22` e rode `corepack enable`
2. rode `corepack pnpm install`
3. copie `.env.example` para `.env`
4. garanta `MongoDB`, `RabbitMQ` e `MinIO` acessiveis nas URLs configuradas
5. suba a API com `corepack pnpm run dev:api`
6. suba o worker com `corepack pnpm run dev:worker`

Variaveis obrigatorias do runtime `real`:

- `MONGODB_URI`
- `RABBITMQ_URL`
- `RABBITMQ_QUEUE_PROCESSING_REQUESTED`
- `MINIO_ENDPOINT`
- `MINIO_PORT`
- `MINIO_USE_SSL`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET_ORIGINALS`

### OCR interno para PDF

- `application/pdf` usa `pdfinfo` para contagem de paginas na API
- o worker usa `pdftoppm` para renderizar cada pagina em `PNG`
- o worker usa `tesseract` com idioma `por` para OCR local
- variaveis de runtime: `PDFINFO_BINARY`, `PDFTOPPM_BINARY`, `TESSERACT_BINARY`, `TESSERACT_LANGUAGE`

Para rodar o smoke nativo real de PDF:

```powershell
$env:RUN_NATIVE_PDF_TESTS='true'
corepack pnpm test:contracts
```

### Docker de desenvolvimento e producao

O repositorio inclui `Dockerfile` multi-stage e `docker-compose.dev.yml` para desenvolvimento em runtime `real`.

Bootstrap dev em container:

```powershell
Copy-Item .env.docker.dev.example .env.docker.dev
docker compose --env-file .env.docker.dev -f docker-compose.dev.yml up --build api-dev
docker compose --env-file .env.docker.dev -f docker-compose.dev.yml up --build worker-dev
```

Build de producao:

```bash
docker build --target prod -t document-parser .
docker run --rm -p 3000:3000 --env-file .env document-parser api
docker run --rm --env-file .env document-parser worker
```

### Observabilidade e LLM remoto

Observabilidade:

- `OBSERVABILITY_MODE=local|otlp`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_SERVICE_NAME`

Fallback LLM remoto:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `HUGGINGFACE_API_KEY`
- `HUGGINGFACE_MODEL`
- `HUGGINGFACE_BASE_URL`
- `LLM_REQUEST_TIMEOUT_MS`
- `LLM_MAX_CONCURRENCY`
- `LLM_MAX_RETRIES`
- `LLM_RETRY_BASE_DELAY_MS`

### Qualidade e CI

Checks obrigatorios do caminho principal:

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test:domain`
- `corepack pnpm test:application`
- `corepack pnpm test:e2e`

Testes reais de infraestrutura continuam opt-in:

```powershell
$env:RUN_REAL_INFRA_TESTS='true'
corepack pnpm test:contracts
```

## Documentacao derivada

- [Schemas futuros de persistencia](docs/database-schemas.md)
- [Reavaliacao tecnica de duplicacoes e prioridades](docs/relatorio-logica-duplicacoes.md)
- [Mapa de contexto DDD](docs/ddd/00-context-map.md)
- [DDD de Ingestion](docs/ddd/01-ingestion.md)
- [DDD de Document Processing](docs/ddd/02-document-processing.md)
- [DDD de OCR e LLM Extraction](docs/ddd/03-ocr-llm-extraction.md)
- [DDD de Result Delivery](docs/ddd/04-result-delivery.md)
- [DDD de Audit e Observability](docs/ddd/06-audit-observability.md)
- [Plano de implementacao](docs/plano-implementacao.md)
- [Historico tecnico](docs/changelog.md)
