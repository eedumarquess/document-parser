# DDD: Result Delivery

## Objetivo

Expor status, resultado final e reprocessamento sem obrigar o consumidor a entender a complexidade interna da pipeline.

## Decisoes fechadas do MVP

- `GET /v1/parsing/jobs/{jobId}` expoe status do job
- `GET /v1/parsing/jobs/{jobId}/result` expoe payload final e metadados minimos
- `POST /v1/parsing/jobs/{jobId}/reprocess` cria novo job para o mesmo `documentId`
- O payload externo do MVP e texto consolidado com marcacoes, nao um conjunto obrigatorio de campos estruturados
- Links temporarios para artefatos sao opcionais e ficam fora do contrato minimo
- O sistema nasce `single-tenant`, com RBAC simples `OWNER` e `OPERATOR`

## Agregado `ProcessingResult`

Saida versionada produzida pelo worker e entregue pela API.

### Atributos principais

- `resultId`
- `jobId`
- `documentId`
- `status`
- `requestedMode`
- `outputVersion`
- `pipelineVersion`
- `normalizationVersion`
- `promptVersion`
- `modelVersion`
- `confidenceScore`
- `warnings`
- `payload`
- `createdAt`

## Objeto de politica `ResultAccessPolicy`

No MVP:

- `OWNER` pode submeter, consultar e reprocessar
- `OPERATOR` pode consultar status e resultado

A verificacao continua atras de porta para preservar a evolucao futura.

## Contrato externo minimo

```json
{
  "jobId": "job_123",
  "documentId": "doc_123",
  "status": "COMPLETED",
  "requestedMode": "STANDARD",
  "pipelineVersion": "git:9f2ab17",
  "outputVersion": "1.0.0",
  "confidence": 0.91,
  "warnings": [],
  "payload": "Paciente consciente. Observacao manuscrita: [ilegivel]."
}
```

O contrato minimo nao expoe por padrao:

- `hash`
- `pageSummaries`
- confianca por campo
- links para artefatos internos

Essas informacoes podem existir internamente no read model, mas nao fazem parte do contrato publico do MVP.

## Regras de negocio

- Um resultado sempre pertence a um job especifico.
- Reprocessamento nunca sobrescreve o resultado anterior.
- O contrato externo deve permanecer estavel por `outputVersion`.
- `PARTIAL` e exposto quando o payload e utilizavel, mas possui lacunas reconhecidas.
- `FAILED` nao retorna `payload`, apenas metadados e erro funcional.

## Taxonomia inicial de erros expostos

- `VALIDATION_ERROR`
- `AUTHORIZATION_ERROR`
- `NOT_FOUND`
- `TRANSIENT_FAILURE`
- `FATAL_FAILURE`
- `TIMEOUT`
- `DLQ_ERROR`
- `REPROCESSING_ERROR`

## Servicos de dominio

- `ResultAssemblerService`
- `ResultAccessPolicy`
- `ResultErrorContractService`
- `ReprocessAuthorizationService`

## Portas

### Entrada

- `GetJobStatusQuery`
- `GetProcessingResultQuery`
- `ReprocessJobCommand`

### Saida

- `ProcessingJobReadModelPort`
- `ProcessingResultReadModelPort`
- `AuthorizationPort`
- `AuditPort`
- `ClockPort`

## Regras de clean code para este contexto

- queries nao devem reconstruir regra de negocio ja encapsulada no dominio
- o assembler de resposta deve ter funcoes nomeadas, por exemplo `buildPublicProcessingResultResponse`
- reprocessamento deve viver em caso de uso proprio, nunca como `if` escondido no controller
- controllers devem apenas mapear HTTP para query ou command

## Plano de implementacao orientado a TDD

1. Criar testes do `ResultAssemblerService` para `COMPLETED`, `PARTIAL` e `FAILED`.
2. Criar testes do `GetJobStatusQuery`.
3. Criar testes do `GetProcessingResultQuery`.
4. Criar testes do `ReprocessJobCommand`, garantindo novo job e preservacao do historico.
5. Criar contract tests HTTP dos endpoints de status, resultado e reprocessamento.
6. Criar testes E2E cobrindo submissao, consulta, deduplicacao e reprocessamento.

## Cenarios de teste obrigatorios

- retorna metadados minimos e `payload` textual para job concluido
- retorna `PARTIAL` com warnings quando o resultado for incompleto
- retorna erro funcional quando o job ainda nao tem resultado
- retorna erro funcional quando o job nao existir
- cria novo job ao reprocessar sem apagar o resultado anterior
- gera auditoria ao consultar resultado
