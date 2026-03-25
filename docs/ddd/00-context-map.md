# Context Map

## Decisoes estrategicas do MVP

- Bounded context raiz: `Document Parsing`
- Projeto de portfolio e aprendizado, operando como `single-tenant`
- Papel efetivo no MVP: `OWNER`
- Entrada inicial: apenas `multipart/form-data`
- MIME types aceitos: `application/pdf`, `image/jpeg`, `image/png`
- Limites de aceite: `50 MB` e `10 paginas`
- Dois servicos desde o inicio: `orchestrator-api` e `document-processing-worker`
- Cada servico possui seu proprio hexagono, mas ambos compartilham o mesmo `MongoDB` no MVP
- `RabbitMQ` e o canal oficial de integracao assincrona
- `MinIO` e a fonte oficial dos binarios e artefatos
- O payload externo do MVP e texto consolidado com marcacoes semanticas e metadados minimos
- `Template Management` fica fora do contrato e do schema do MVP

## Arquitetura base orientada a TDD

Cada servico nasce com a mesma estrutura logica:

```text
src/
  domain/
    entities/
    value-objects/
    services/
    policies/
  application/
    commands/
    queries/
    use-cases/
  adapters/
    in/
    out/
  contracts/
tests/
  domain/
  application/
  contracts/
  e2e/
```

Regras de implementacao:

1. Regras de negocio ficam em `domain` e devem ser exercitadas primeiro por testes unitarios.
2. Casos de uso ficam em `application` e devem ser testados com adapters em memoria antes da infra real.
3. Controllers HTTP, consumers de fila e clients externos ficam em `adapters`.
4. Funcoes devem ter nomes explicitos, por exemplo `validateUploadedFileConstraints`, `calculateDocumentHash`, `decideCompatibleResultReuse`, `buildMaskedPromptForLlm`.
5. Nada de regra de negocio em controller, consumer ou repository.

## Estrategia de teste transversal

1. `Domain tests`
   Cobrem entidades, value objects, servicos e politicas puras.
2. `Application tests`
   Cobrem casos de uso com fakes em memoria e validam orquestracao.
3. `Contract tests`
   Cobrem adapters de `MongoDB`, `RabbitMQ`, `MinIO`, OCR e LLM.
4. `E2E tests`
   Cobrem `POST /jobs`, consumo assincrono, consulta de status, consulta de resultado e reprocessamento.
5. `Golden dataset tests`
   Cobrem qualidade do texto consolidado, marcacao de manuscrito, `[ilegivel]` e SLA de ate `30s`.

## Subdominios

| Subdominio | Tipo | Dono principal | Status no MVP | Papel na implementacao |
| --- | --- | --- | --- | --- |
| `Ingestion` | Supporting | `orchestrator-api` | Ativo | Receber upload, validar, calcular hash, deduplicar e criar jobs |
| `Document Processing` | Core | ambos | Ativo | Governar estado do job, tentativas, retries, DLQ e reprocessamento |
| `OCR/LLM Extraction` | Core | `document-processing-worker` | Ativo | Executar pipeline OCR -> heuristicas -> fallback LLM |
| `Result Delivery` | Supporting | `orchestrator-api` | Ativo | Expor status, resultado e comando de reprocessamento |
| `Template Management` | Supporting/Future | futuro servico administrativo | Futuro | Fica explicitado, mas sem contrato nem schema no MVP |
| `Audit/Observability` | Generic/Transversal | ambos | Ativo | Auditoria, metricas, logs, traces, retry e DLQ |

## Relacoes entre subdominios

1. `Ingestion` recebe o arquivo, valida limites e calcula `hash`.
2. `Ingestion` consulta resultado compativel usando `hash + requestedMode + pipelineVersion + outputVersion`.
3. `Ingestion` reaproveita o `Document` quando o hash ja existir e cria sempre um novo `ProcessingJob`.
4. `Document Processing` decide se o job segue para fila ou se reutiliza um resultado compativel.
5. `OCR/LLM Extraction` executa a pipeline no worker quando o job realmente precisa ser processado.
6. `Result Delivery` entrega o estado do job e o resultado final sem expor artefatos internos por padrao.
7. `Audit/Observability` registra operacoes de submissao, consulta de resultado, reprocessamento e falhas criticas.

## Fronteiras de servico

### `orchestrator-api`

- Dono da entrada HTTP
- Dono do aceite do documento e criacao do job
- Dono dos queries externos de status e resultado
- Dono do comando de reprocessamento

### `document-processing-worker`

- Dono do consumo da fila
- Dono da execucao da pipeline
- Dono da criacao de `JobAttempt`, `ProcessingResult` e artefatos tecnicos

### Integracao entre os servicos

- Integracao principal por mensagem no `RabbitMQ`
- Payload minimo da fila: `documentId`, `jobId`, `attemptId`, `requestedMode`, `pipelineVersion`, `publishedAt`
- Como o banco e compartilhado no MVP, o worker le o restante do contexto no `MongoDB`
- Nao existe chamada HTTP servico-a-servico no MVP

## Shared kernel minimo

O unico compartilhamento aceitavel entre os servicos e tecnico, nunca de regra de negocio:

- contrato da mensagem de fila
- taxonomia de erros
- versionamento tecnico
- fixtures de teste e testkit
- convencoes de observabilidade

## Linguagem ubiqua minima

| Termo | Significado |
| --- | --- |
| `Document` | Binario canonico identificado por `hash` |
| `ProcessingJob` | Pedido assincrono para processar ou reaproveitar um resultado |
| `JobAttempt` | Tentativa concreta de execucao no worker |
| `ProcessingResult` | Saida versionada ligada a um job |
| `Artifact` | Evidencia tecnica persistida em storage |
| `Compatible Result` | Resultado cujo reuso e valido pela chave oficial de idempotencia |
| `Fallback` | Troca controlada de estrategia quando o OCR primario nao basta |
| `Golden Dataset` | Base versionada usada para aceite de qualidade |

## Ownership de persistencia no MVP

- `documents`: ownership logico do `orchestrator-api`
- `processing_jobs`: criado pela API e atualizado por API + worker
- `job_attempts`: ownership logico do worker
- `processing_results`: ownership logico do worker
- `page_artifacts`: ownership logico do worker
- `audit_events`: ownership compartilhado por meio de porta de auditoria
- `dead_letter_events`: ownership logico do worker

## Sequencia recomendada de implementacao

1. Fundacao TDD dos dois hexagonos, contratos e testkit
2. `Ingestion`
3. `Document Processing` no fluxo de aceite e deduplicacao
4. Worker com pipeline OCR basica
5. `Result Delivery`
6. Reprocessamento
7. `Audit/Observability`
8. Golden dataset, hardening e tuning
