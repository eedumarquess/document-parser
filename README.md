# Document Parser

Parser documental assincrono para ficha clinica, com foco em reduzir digitacao manual e devolver texto consolidado com marcacoes semanticas.

## Visao geral

O MVP processa documentos enviados via `multipart/form-data`, armazena o arquivo bruto no storage, cria um job assincrono e delega o processamento a um worker especializado. O resultado final e persistido e exposto por uma API orientada a jobs.

O contrato externo do MVP e minimo. A resposta final contem:

- `jobId`
- `documentId`
- `status`
- `requestedMode`
- `pipelineVersion`
- `outputVersion`
- `confidence`
- `warnings`
- `payload` textual consolidado com marcacoes semanticas

## Objetivos do MVP

- Substituir o preenchimento manual das informacoes do laudo por um pipeline automatizado
- Suportar `PDF`, `JPG` e `PNG`
- Operar sempre em modo assincrono com `job/status`
- Persistir documentos, artefatos e resultados para historico e reprocessamento
- Entregar rastreabilidade, observabilidade e versionamento desde a primeira versao

## Escopo funcional

### Entrada

- Upload via `multipart/form-data`
- Limite de ate 10 paginas
- Tamanho maximo de 50 MB
- Tipos aceitos: `application/pdf`, `image/jpeg`, `image/png`

### Saida

- Texto unico concatenado com marcacoes semanticas
- Marcador explicito `[ilegivel]` quando aplicavel
- Idioma otimizado para `pt-BR`
- Resposta final com metadados minimos de execucao

### Comportamentos obrigatorios

- Idempotencia por hash do arquivo combinado com versao de pipeline
- Reaproveitamento de resultado quando o mesmo documento ja tiver sido processado de forma compativel
- Reprocessamento manual com novo job e `forceReprocess=true`
- Fallback `OCR tradicional -> validacao heuristica -> LLM`
- DLQ para mensagens nao processadas

## Arquitetura proposta

### Servicos

1. `orchestrator-api`
   Responsavel por validacao, ingestao, persistencia, criacao de jobs, consulta de status e entrega do resultado.

2. `document-processing-worker`
   Responsavel por renderizacao por pagina, OCR, heuristicas, fallback para LLM e montagem do resultado final.

### Infraestrutura prevista

- `MongoDB`: metadados, jobs, resultados, artefatos e auditoria
- `MinIO`: arquivo original e artefatos derivados
- `RabbitMQ`: fila principal, retry e DLQ
- `OpenTelemetry` via `OTLP/HTTP` ou adapters locais: metricas, logs estruturados e traces

### Fluxo ponta a ponta

1. Cliente envia arquivo para `POST /v1/parsing/jobs`
2. API valida MIME, tamanho, numero de paginas e hash
3. Documento bruto e salvo no storage
4. API registra documento e job no banco
5. API publica mensagem com referencia segura do arquivo na fila
6. Worker consome a mensagem e executa OCR, heuristicas e fallback para LLM quando necessario
7. Worker produz payload textual consolidado, warnings e confidence
8. Resultado e persistido no banco e artefatos no storage
9. Cliente consulta status e resultado pelos endpoints de job

## Bounded context e subdominios

O bounded context raiz e `Document Parsing`. Os subdominios planejados sao:

- `Ingestion`
- `Document Processing`
- `OCR/LLM Extraction`
- `Result Delivery`
- `Template Management`
- `Audit/Observability`

`Template Management` fica explicitado, mas fora do contrato e do schema do MVP.

## Base tecnica atual

O repositorio ja contem:

- monorepo `pnpm`
- dois apps `NestJS`: `orchestrator-api` e `document-processing-worker`
- `packages/shared-kernel` apenas com contratos tecnicos e enums compartilhados
- `packages/testkit` com builders, fakes, clock fixo e helpers de teste
- estrutura hexagonal em ambos os servicos
- suites `domain`, `application`, `contracts` e `e2e`

## Como iniciar

### Sem Docker

Para subir localmente sem containers:

1. instale `Node.js 22` e rode `corepack enable`
2. rode `corepack pnpm install`
3. copie `.env.example` para `.env` e carregue as variaveis no shell ou na IDE
4. garanta que `MongoDB`, `RabbitMQ` e `MinIO` estejam acessiveis nas URLs configuradas
5. suba a API com `corepack pnpm run dev:api`
6. suba o worker com `corepack pnpm run dev:worker`

Por default, a API escuta na porta `3000`. Para o fluxo distribuido completo, use runtime `real` com as variaveis abaixo:

- `MONGODB_URI`
- `RABBITMQ_URL`
- `RABBITMQ_QUEUE_PROCESSING_REQUESTED`
- `MINIO_ENDPOINT`
- `MINIO_PORT`
- `MINIO_USE_SSL`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET_ORIGINALS`

Variaveis opcionais de LLM remoto no worker:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `HUGGINGFACE_API_KEY`
- `HUGGINGFACE_MODEL`
- `HUGGINGFACE_BASE_URL`

### OCR interno para PDF

- `application/pdf` usa `pdfinfo` para contagem de paginas na API
- o worker usa `pdftoppm` para renderizar cada pagina em `PNG`
- o worker usa `tesseract` com idioma `por` para OCR local
- variaveis de runtime: `PDFINFO_BINARY`, `PDFTOPPM_BINARY`, `TESSERACT_BINARY`, `TESSERACT_LANGUAGE`
- para rodar o smoke test nativo localmente, use `RUN_NATIVE_PDF_TESTS=true`

### Base local automatizada no Windows

Se quiser rodar a API e o worker localmente e deixar so a infraestrutura no Docker:

1. ajuste `.env` como base local; se ele nao existir o script usa `.env.example`
2. execute `.\start-dev.ps1`

O script:

- sobe `MongoDB`, `RabbitMQ` e `MinIO` com `docker-compose.local.yml`
- inicializa o replica set do Mongo para suportar transacoes
- abre duas janelas do PowerShell, uma para a API e outra para o worker, ambas em watch mode

Interfaces uteis:

- RabbitMQ: `http://localhost:15672`
- MinIO Console: `http://localhost:9001`

### Docker para desenvolvimento

O repositorio agora inclui `Dockerfile` multi-stage e `docker-compose.dev.yml` para desenvolvimento em runtime `real`, reaproveitando infra externa ja existente.

1. copie `.env.docker.dev.example` para `.env.docker.dev`
2. ajuste a conectividade para `MongoDB`, `RabbitMQ` e `MinIO`
3. opcionalmente defina `PNPM_LINK_MAP` para linkar libs locais montadas no mesmo diretorio pai
4. suba a API com `docker compose --env-file .env.docker.dev -f docker-compose.dev.yml up --build api-dev`
5. suba o worker com `docker compose --env-file .env.docker.dev -f docker-compose.dev.yml up --build worker-dev`

O compose monta `..:/workspace`, entao o container enxerga repositorios irmaos do diretorio atual. O formato de `PNPM_LINK_MAP` e um JSON que mapeia o pacote consumidor para uma lista de caminhos absolutos dentro do container. Exemplo:

```json
{
  "@document-parser/orchestrator-api": ["/workspace/minha-lib"],
  "@document-parser/document-processing-worker": ["/workspace/outra-lib"]
}
```

O bootstrap do container:

- roda `pnpm install --frozen-lockfile` no monorepo
- roda `pnpm install` em cada lib externa declarada
- aplica `pnpm --filter <workspace> link <caminho-da-lib>`
- inicia `tsc -b --watch` para os pacotes compartilhados e para o servico selecionado
- inicia `node --watch` sobre `dist/src/main.js`

### Build e runtime de producao

Para gerar a imagem final:

```bash
docker build --target prod -t document-parser .
```

A mesma imagem pode subir a API ou o worker:

```bash
docker run --rm -p 3000:3000 --env-file .env document-parser api
docker run --rm --env-file .env document-parser worker
```

Se nenhum comando for informado, a imagem sobe a API por default.

## Hardening operacional atual

O estado atual do repositorio ja inclui os pilares principais da fase 3:

- observabilidade via `LoggingPort`, `MetricsPort` e `TracingPort`, com adapters locais por default e export opcional via `OTLP/HTTP`
- persistencia consultavel de telemetria em `telemetry_events`, com fan-out para o sink configurado e para Mongo no runtime `real`
- `RedactionPolicyService` centralizado para `audit`, `log`, `dead_letter` e `artifact`, com redacao por chave e por conteudo sensivel
- timeout, limite de concorrencia e retry nos adapters LLM remotos
- suites reais de infraestrutura com `testcontainers`, protegidas por `RUN_REAL_INFRA_TESTS=true`

### Variaveis operacionais relevantes

Observabilidade:

- `OBSERVABILITY_MODE=local|otlp`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_SERVICE_NAME`
- `RUN_REAL_INFRA_TESTS=true`

Fallback LLM remoto:

- `LLM_REQUEST_TIMEOUT_MS`
- `LLM_MAX_CONCURRENCY`
- `LLM_MAX_RETRIES`
- `LLM_RETRY_BASE_DELAY_MS`

## API inicial

### Endpoints

- `POST /v1/parsing/jobs`
- `GET /v1/parsing/jobs/{jobId}`
- `GET /v1/parsing/jobs/{jobId}/result`
- `POST /v1/parsing/jobs/{jobId}/reprocess`
- `GET /v1/ops/jobs/{jobId}/context`
- `GET /ops/jobs/{jobId}`

### Painel operacional por job

O MVP agora expoe um caminho interno de leitura operacional centrado em `jobId`.

- `GET /v1/ops/jobs/{jobId}/context` retorna o contexto operacional agregado em JSON
- `GET /ops/jobs/{jobId}` renderiza uma pagina HTML simples para inspecao manual

O contexto agrega `summary`, `attempts`, `result`, `auditEvents`, `deadLetters`, `artifacts`, `traceIds`, `timeline` e telemetria correlacionada por `serviceName`, `traceId` e `attemptId`.

As previas de artefatos sao geradas no read path. O JSON e o HTML nunca devolvem `rawText`, `rawPayload`, `promptText` ou `responseText` crus.

### Resposta minima na criacao do job

```json
{
  "jobId": "job_123",
  "documentId": "doc_123",
  "status": "QUEUED",
  "requestedMode": "STANDARD",
  "pipelineVersion": "dev-sha",
  "outputVersion": "1.0.0",
  "createdAt": "2026-03-25T10:00:00.000Z",
  "reusedResult": false
}
```

## Requisitos nao funcionais

- SLA alvo de 10 a 15 segundos por documento
- SLA maximo funcional de 30 segundos por documento
- Persistencia de resultados para consulta posterior
- Retencao de 30 dias para original e artefatos
- Retencao de 90 dias para OCR bruto e resultado final
- Retencao de 180 dias para auditoria e DLQ
- RBAC simples com `OWNER` e `OPERATOR`
- Criptografia em repouso
- Mascaramento de dados sensiveis em logs
- Mascaramento antes de chamadas a LLM externo

## Qualidade e aceite

O aceite do MVP deve validar:

- processamento de `PDF`, `JPG` e `PNG`
- texto consolidado com marcacoes semanticas
- marcador explicito `[ilegivel]` quando aplicavel
- score de confianca por documento
- erros padronizados para falhas funcionais e tecnicas
- validacao por golden dataset versionado

## Documentacao derivada

- [Schemas futuros de persistencia](docs/database-schemas.md)
- [Mapa de contexto DDD](docs/ddd/00-context-map.md)
- [DDD de Ingestion](docs/ddd/01-ingestion.md)
- [DDD de Document Processing](docs/ddd/02-document-processing.md)
- [DDD de OCR e LLM Extraction](docs/ddd/03-ocr-llm-extraction.md)
- [DDD de Result Delivery](docs/ddd/04-result-delivery.md)
- [DDD de Audit e Observability](docs/ddd/06-audit-observability.md)
- [Plano de implementacao](docs/plano-implementacao.md)
