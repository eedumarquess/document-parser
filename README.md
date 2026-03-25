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
- `Datadog` ou equivalente: metricas, logs estruturados e traces

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

## API inicial

### Endpoints

- `POST /v1/parsing/jobs`
- `GET /v1/parsing/jobs/{jobId}`
- `GET /v1/parsing/jobs/{jobId}/result`
- `POST /v1/parsing/jobs/{jobId}/reprocess`

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
