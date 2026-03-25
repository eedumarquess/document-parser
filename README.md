# Document Parser

Parser documental assíncrono para ficha clínica, com foco em reduzir digitação manual e devolver saída estruturada pronta para consumo futuro.

## Visão geral

O MVP processa documentos enviados via `multipart/form-data`, armazena o arquivo bruto no MinIO, cria um job assíncrono e delega o processamento a um worker especializado. O resultado final é persistido e exposto por uma API orientada a jobs.

O contrato oficial do sistema não é texto puro. A saída deve conter:

- texto consolidado normalizado
- campos extraídos
- checkbox marcado ou desmarcado
- trechos manuscritos
- trechos ilegíveis
- score de confiança
- versões de pipeline, modelo, prompt e contrato

## Objetivos do MVP

- Substituir o preenchimento manual das informações do laudo por um pipeline automatizado
- Suportar `PDF`, `JPG` e `PNG`
- Operar sempre em modo assíncrono com `job/status`
- Persistir documentos, artefatos e resultados para histórico e reprocessamento
- Entregar rastreabilidade, observabilidade e versionamento desde a primeira versão

## Escopo funcional

### Entrada

- Upload via `multipart/form-data`
- Limite de até 10 páginas
- Tamanho máximo de 50 MB
- Tipos aceitos: `application/pdf`, `image/jpeg`, `image/png`

### Saída

- Texto único concatenado
- Preservação semântica de checkbox, campos vazios, manuscrito e ilegibilidade
- Idioma otimizado para `pt-BR`
- Resposta final com metadados ricos de execução

### Comportamentos obrigatórios

- Idempotência por hash do arquivo combinado com versão de pipeline
- Reaproveitamento de resultado quando o mesmo documento já tiver sido processado de forma compatível
- Reprocessamento manual com nova versão, engine ou `forceReprocess=true`
- Fallback `OCR tradicional -> validação heurística -> LLM`
- DLQ para mensagens não processadas

## Arquitetura proposta

### Serviços

1. `orchestrator-api`
   Responsável por validação, ingestão, persistência, criação de jobs, consulta de status e entrega do resultado.

2. `document-processing-worker`
   Responsável por renderização por página, OCR, heurísticas, fallback para LLM, pós-processamento e montagem do payload final.

### Infraestrutura prevista

- `MongoDB`: metadados, jobs, resultados, artefatos e auditoria
- `MinIO`: arquivo original e artefatos derivados
- `RabbitMQ`: fila principal, retry e DLQ
- `Datadog` ou equivalente: métricas, logs estruturados e traces

### Fluxo ponta a ponta

1. Cliente envia arquivo para `POST /v1/parsing/jobs`
2. API valida MIME, tamanho, número de páginas e hash
3. Documento bruto é salvo no MinIO
4. API registra documento e job no MongoDB
5. API publica mensagem com referência segura do arquivo no RabbitMQ
6. Worker consome a mensagem e renderiza o documento por página
7. Worker executa OCR, heurísticas e fallback para LLM quando necessário
8. Worker produz payload enriquecido com texto, campos, checkbox, manuscrito, warnings e confidence
9. Resultado é persistido no MongoDB e artefatos no MinIO
10. Cliente consulta status e resultado pelos endpoints de job

## Bounded context e subdomínios

O bounded context raiz é `Document Parsing`. Os subdomínios planejados são:

- `Ingestion`
- `Document Processing`
- `OCR/LLM Extraction`
- `Result Delivery`
- `Template Management`
- `Audit/Observability`

Os detalhes DDD estão em [docs/ddd/00-context-map.md](docs/ddd/00-context-map.md).

## API inicial

### Endpoints

- `POST /v1/parsing/jobs`
- `GET /v1/parsing/jobs/{jobId}`
- `GET /v1/parsing/jobs/{jobId}/result`
- `POST /v1/parsing/jobs/{jobId}/reprocess`

### Resposta mínima na criação do job

```json
{
  "jobId": "job_123",
  "documentId": "doc_123",
  "status": "QUEUED",
  "hash": "sha256:...",
  "mimeType": "application/pdf",
  "pages": 3,
  "createdAt": "2026-03-25T10:00:00.000Z",
  "reusedResult": false
}
```

## Requisitos não funcionais

- SLA alvo de 10 a 15 segundos por documento
- SLA máximo funcional de 30 segundos por documento
- Persistência de resultados para consulta posterior
- Retenção inicial de documentos por 1 ano
- RBAC para acesso a documentos e resultados
- Criptografia em repouso
- Mascaramento de dados sensíveis em logs
- Pseudonimização antes de chamadas a LLM externo

## Qualidade e aceite

O aceite do MVP deve validar:

- processamento de `PDF`, `JPG` e `PNG`
- texto consolidado com marcações semânticas
- distinção entre texto impresso e manuscrito
- marcador explícito `[ilegível]` quando aplicável
- score de confiança por documento
- erros padronizados para falhas funcionais e técnicas
- validação por golden dataset versionado

## Documentação derivada

- [Schemas futuros de persistência](docs/database-schemas.md)
- [Mapa de contexto DDD](docs/ddd/00-context-map.md)
- [DDD de Ingestion](docs/ddd/01-ingestion.md)
- [DDD de Document Processing](docs/ddd/02-document-processing.md)
- [DDD de OCR e LLM Extraction](docs/ddd/03-ocr-llm-extraction.md)
- [DDD de Result Delivery](docs/ddd/04-result-delivery.md)
- [DDD de Template Management](docs/ddd/05-template-management.md)
- [DDD de Audit e Observability](docs/ddd/06-audit-observability.md)
- [Plano de implementação](docs/plano-implementacao.md)

## Estado atual do repositório

Este repositório está em fase de definição arquitetural. Os documentos acima servem como base para iniciar a implementação dos dois serviços, da infraestrutura e do modelo de dados.
