# Document Intelligence Pipeline - Semana 1 (v0.1)

Versao inicial focada em ingestao assincrona de documentos com `NestJS + PostgreSQL + RabbitMQ`.

## O que esta implementado

- `POST /documents` (multipart) para upload de `pdf/doc/docx/txt` (limite 20MB).
- Persistencia de metadados no PostgreSQL.
- Publicacao de mensagem para processamento assincrono no RabbitMQ.
- Worker dedicado consumindo fila principal com `prefetch=5`.
- Retry com backoff via fila de retry (TTL 10s) e DLQ apos 3 tentativas.
- `GET /documents/:id` para acompanhar status do documento.
- `GET /health` verificando PostgreSQL e RabbitMQ.
- Logs JSON estruturados em API e worker.

## Arquitetura local

Client -> API (`apps/api`) -> RabbitMQ -> Worker (`apps/worker`) -> PostgreSQL

Filas:
- `documents.process.q`
- `documents.retry.q`
- `documents.dlq.q`

Exchange:
- `documents.x` (direct)

## Status de documento

- `QUEUED`
- `PROCESSING`
- `PROCESSED`
- `FAILED`
- `DLQ`

## Requisitos

- Node.js 22+
- Docker + Docker Compose

## Execucao local (Docker)

```bash
docker compose up --build
```

Servicos:
- API: `http://localhost:3000`
- RabbitMQ UI: `http://localhost:15672` (`guest/guest`)
- PostgreSQL: `localhost:5432`

## Fluxo de teste manual

### 1. Upload de documento

```bash
curl -X POST http://localhost:3000/documents \
  -F "file=@./README.md;type=text/plain" \
  -F 'metadata={"source":"manual-test"}'
```

Resposta esperada:
- HTTP `202`
- body com `id`, `status=QUEUED`, `createdAt`

### 2. Consultar status

```bash
curl http://localhost:3000/documents/<document-id>
```

### 3. Forcar falha para validar retry + DLQ

```bash
curl -X POST http://localhost:3000/documents \
  -F "file=@./README.md;type=text/plain" \
  -F 'metadata={"forceFail":true}'
```

Depois de 3 tentativas, status esperado: `DLQ`.

## Desenvolvimento local sem Docker

1. Suba PostgreSQL e RabbitMQ localmente.
2. Configure variaveis de ambiente:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=document_parser
RABBITMQ_URL=amqp://guest:guest@localhost:5672
DOCUMENT_STORAGE_PATH=./data/documents
PORT=3000
```

3. Execute:

```bash
npm install
npm run start:dev
```

Em outro terminal:

```bash
npm run start:worker:dev
```

## Scripts

- `npm run build`
- `npm run start:dev`
- `npm run start:worker:dev`
- `npm run test`
- `npm run test:e2e`
- `npm run test:e2e:worker`

## Testes implementados

- Controller de documentos (happy path + validacoes basicas).
- Health controller (status OK e erro).
- Worker consumer (processamento OK, retry e DLQ).

## Observacoes

- JWT, embeddings e RAG ficam para as proximas semanas.
- A API executa migrations TypeORM no bootstrap.
