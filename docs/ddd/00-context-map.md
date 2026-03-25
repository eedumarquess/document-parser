# Context Map

## Bounded context raiz

`Document Parsing`

O sistema nasce como plataforma de parsing documental. A ficha clínica é o primeiro caso de uso, mas não redefine o domínio raiz.

## Subdomínios

| Subdomínio | Tipo | Serviço principal | Responsabilidade |
| --- | --- | --- | --- |
| `Ingestion` | Supporting | `orchestrator-api` | Receber, validar, identificar e aceitar documentos |
| `Document Processing` | Core | `orchestrator-api` + `document-processing-worker` | Orquestrar jobs, pipeline e ciclo de vida do processamento |
| `OCR/LLM Extraction` | Core | `document-processing-worker` | Extrair texto, manuscrito, checkbox e sinais de qualidade |
| `Result Delivery` | Supporting | `orchestrator-api` | Expor status, resultado final e reprocessamento |
| `Template Management` | Supporting/Future | serviço administrativo futuro | Versionar templates e regras de matching |
| `Audit/Observability` | Generic/Transversal | ambos | Auditabilidade, métricas, logs, traces e DLQ |

## Relações entre subdomínios

1. `Ingestion` aceita o documento, calcula hash, salva o original e cria um `ProcessingJob`
2. `Document Processing` publica comando assíncrono para o worker
3. `OCR/LLM Extraction` executa pipeline plugável e devolve payload enriquecido
4. `Result Delivery` persiste a versão final e expõe consulta e reprocessamento
5. `Audit/Observability` recebe eventos de todos os subdomínios
6. `Template Management` é opcional no MVP, mas já existe como fronteira explícita

## Agregados centrais compartilhados

- `Document`
- `ProcessingJob`
- `ProcessingResult`
- `TemplateDefinition` futuro

## Linguagem ubíqua mínima

| Termo | Significado |
| --- | --- |
| `Document` | Binário original submetido ao sistema e seus metadados |
| `ProcessingJob` | Pedido assíncrono de processamento com modo e estado |
| `JobAttempt` | Tentativa concreta de execução do job |
| `ProcessingResult` | Saída versionada produzida pelo pipeline |
| `Artifact` | Evidência derivada do documento, como render por página |
| `Fallback` | Troca controlada de engine ao longo da pipeline |
| `Confidence` | Medida agregada de confiança do resultado |
| `Golden Dataset` | Base de referência para aceite e regressão |

## Mapa de ownership

- `orchestrator-api`
  - `Ingestion`
  - parte transacional de `Document Processing`
  - `Result Delivery`

- `document-processing-worker`
  - execução operacional de `Document Processing`
  - `OCR/LLM Extraction`

- transversais
  - `Audit/Observability`
  - contratos para `Template Management`
