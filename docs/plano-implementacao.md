# Plano de Implementacao

## Objetivo

Construir o MVP do parser documental com dois servicos independentes, arquitetura hexagonal, TDD como estrategia principal de entrega e foco inicial em texto consolidado com marcacoes semanticas.

## Principios de implementacao

- `DDD` para separar responsabilidades por subdominio
- `Hexagonal architecture` em cada servico
- `TDD first` para dominio e aplicacao
- `Clean code` com funcoes nomeadas explicitamente
- `Single-tenant` no MVP, sem supermodelar RBAC ou tenancy
- `Template Management` fora do contrato inicial

## Arquitetura alvo do repositorio

O repositorio pode nascer como monorepo com dois deployables independentes:

```text
apps/
  orchestrator-api/
    src/
      domain/
      application/
      adapters/
      contracts/
    tests/
      domain/
      application/
      contracts/
      e2e/
  document-processing-worker/
    src/
      domain/
      application/
      adapters/
      contracts/
    tests/
      domain/
      application/
      contracts/
      e2e/
packages/
  job-contracts/
  testkit/
  observability-contracts/
infra/
  docker-compose.yml
  rabbitmq/
  mongo/
  minio/
```

Regras importantes:

- dominio nao pode ser compartilhado entre os dois servicos
- pacotes compartilhados so podem conter contratos tecnicos, fixtures e utilitarios de teste
- controllers HTTP e consumers de fila vivem em `adapters/in`
- `MongoDB`, `MinIO`, `RabbitMQ`, OCR e LLM vivem em `adapters/out`

## Estrategia TDD oficial

Cada fatia de implementacao deve seguir esta ordem:

1. escrever testes de dominio para regras puras
2. escrever testes de aplicacao para o caso de uso com doubles em memoria
3. implementar portas e adapters reais
4. escrever contract tests dos adapters
5. fechar a fatia com um teste E2E

## Convencoes de clean code

- evitar helpers genericos como `process`, `handle`, `runStep` quando a regra puder receber nome mais explicito
- um caso de uso por arquivo
- uma politica relevante por classe ou modulo
- `controller` e `consumer` so traduzem entrada para `command` ou `query`
- efeitos colaterais saem do dominio por portas

Exemplos de nomes esperados:

- `validateUploadedFileConstraints`
- `calculateDocumentHash`
- `buildCompatibilityKey`
- `decideRetryAfterAttemptFailure`
- `buildMaskedPromptForLlm`
- `buildPublicProcessingResultResponse`

## Decisoes funcionais que guiam o roadmap

- entrada apenas por upload multipart
- `PDF`, `JPEG` e `PNG`
- limite de `50 MB` e `10 paginas`
- deduplicacao por `hash + requestedMode + pipelineVersion + outputVersion`
- duplicidade cria novo job com `reusedResult=true`
- `requestedMode=STANDARD`
- `priority=NORMAL`
- worker e API compartilham o mesmo banco no MVP
- fallback LLM por heuristica em nivel de campo
- resultado externo minimo: texto consolidado com marcacoes + metadados minimos
- retries exponenciais com ate `3` tentativas e DLQ obrigatoria

## Fase 0: Fundacao TDD e arquitetura

### Entregas

- estrutura dos dois servicos com seus hexagonos
- pacotes compartilhados apenas para contratos tecnicos e testkit
- base de testes com suites de dominio, aplicacao, contrato e E2E
- `docker-compose` com `MongoDB`, `RabbitMQ` e `MinIO`
- base de observabilidade local
- convencao de versionamento tecnico

### Criterio de saida

- os dois servicos sobem localmente
- existe teste de arquitetura impedindo dependencia indevida entre `domain`, `application` e `adapters`
- existe pipeline CI minima rodando testes

## Fase 1: Ingestion e aceite do documento

### Entregas

- `POST /v1/parsing/jobs`
- validacao de MIME, tamanho e paginas
- calculo de hash
- persistencia do original no `MinIO`
- criacao ou reuso do `Document`
- criacao do `ProcessingJob`

### Testes que devem nascer junto

- policy tests de validacao do upload
- policy tests da chave de compatibilidade
- application tests de `SubmitDocumentUseCase`
- contract tests de `MongoDB`, `MinIO` e `RabbitMQ`

### Criterio de saida

- upload valido cria `Document` e `ProcessingJob`
- upload invalido falha cedo com erro padronizado

## Fase 2: Duplicidade, estados iniciais e status

### Entregas

- fluxo `RECEIVED -> VALIDATED -> STORED`
- fluxo de deduplicacao com `reusedResult=true`
- criacao do primeiro `JobAttempt` com `PENDING`
- `GET /v1/parsing/jobs/{jobId}`
- primeira taxonomia de erros

### Testes que devem nascer junto

- state-machine tests de `ProcessingJob`
- state-machine tests de `JobAttempt`
- E2E cobrindo job deduplicado e job enfileirado

### Criterio de saida

- duplicidade compativel nao publica mensagem
- consulta de status reflete corretamente o caminho percorrido

## Fase 3: Worker e pipeline OCR base

### Entregas

- consumo da fila principal
- renderizacao por pagina
- OCR tradicional
- persistencia de render por pagina e OCR bruto
- consolidacao de texto unico
- classificacao inicial de `COMPLETED`, `PARTIAL` e `FAILED`

### Testes que devem nascer junto

- application tests do worker com adapters fake
- contract tests do OCR
- testes do consolidator de texto

### Criterio de saida

- documento percorre fila, gera resultado e fica consultavel
- falhas transitorias geram retry controlado

## Fase 4: Heuristicas, manuscrito e fallback LLM

### Entregas

- deteccao de manuscrito e checkbox
- marcador `[ilegivel]`
- heuristicas de fallback
- mascaramento de dados sensiveis
- chamada a LLM em nivel de campo
- persistencia de texto mascarado, prompt e resposta

### Testes que devem nascer junto

- testes das heuristicas de fallback
- testes de mascaramento
- contract tests do adapter de LLM
- testes de classificacao `PARTIAL`

### Criterio de saida

- fallback so dispara quando a heuristica justificar
- resultado parcial fica rastreavel e auditavel

## Fase 5: Result Delivery e reprocessamento

### Entregas

- `GET /v1/parsing/jobs/{jobId}/result`
- `POST /v1/parsing/jobs/{jobId}/reprocess`
- versionamento de `outputVersion`
- preservacao de historico por `documentId`

### Testes que devem nascer junto

- tests do `ResultAssemblerService`
- tests do `ReprocessJobCommand`
- contract tests HTTP dos endpoints
- E2E cobrindo reprocessamento fim a fim

### Criterio de saida

- resultado exposto com contrato minimo estavel
- reprocessamento gera novo job sem sobrescrever o anterior

## Fase 6: Auditabilidade, qualidade e hardening

### Entregas

- auditoria de submissao, leitura de resultado e reprocessamento
- traces correlacionando API, fila e worker
- metricas por etapa
- DLQ com replay manual
- politicas de retencao
- golden dataset versionado
- testes de SLA ate `30s`

### Testes que devem nascer junto

- tests de redacao e auditoria
- tests de DLQ e replay
- aceite contra golden dataset
- smoke tests de performance

### Criterio de saida

- trilha de auditoria completa para as operacoes criticas
- qualidade e latencia medidas de forma reproduzivel

## Backlog pos-MVP

- `Template Management`
- campos estruturados como contrato principal
- revisao humana assistida
- pseudonimizacao transversal
- multi-tenant
- painel operacional

## Riscos principais

- OCR inicial insuficiente para manuscrito
- acoplamento indevido ao banco compartilhado
- explosao de complexidade antes do golden dataset real
- latencia alta no fallback para LLM

## Mitigacao

- comecar por texto consolidado antes de campos estruturados
- manter portas explicitas mesmo com banco compartilhado
- medir latencia por etapa desde a fase 0
- so elevar complexidade depois que os testes de aceite mostrarem necessidade
