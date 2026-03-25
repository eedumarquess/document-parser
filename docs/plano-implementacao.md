# Plano de Implementação

## Objetivo

Construir o MVP do parser documental com dois serviços independentes, persistência, fila, storage, versionamento e base de qualidade por golden dataset.

## Premissas

- Bounded context raiz: `Document Parsing`
- Dois serviços desde o início: `orchestrator-api` e `document-processing-worker`
- Stack prevista: `MongoDB`, `MinIO`, `RabbitMQ`, OCR interno, LLM externo opcional
- Todo processamento será assíncrono

## Fase 1: Fundação do repositório

### Entregas

- Estrutura do monorepo ou workspace com dois serviços
- Convenções de lint, test, env e versionamento
- Docker Compose com `MongoDB`, `MinIO` e `RabbitMQ`
- Base de observabilidade local

### Critério de saída

- Subida local completa da stack
- Health checks básicos dos dois serviços

## Fase 2: Ingestion e criação de jobs

### Entregas

- `POST /v1/parsing/jobs`
- Validação de MIME, tamanho e número de páginas
- Cálculo de hash
- Persistência do original no MinIO
- Criação de `Document` e `ProcessingJob`
- Publicação do comando no RabbitMQ

### Critério de saída

- Upload gera documento e job persistidos
- Mensagem publicada na fila principal

## Fase 3: Consulta de status e idempotência

### Entregas

- `GET /v1/parsing/jobs/{jobId}`
- Política de reaproveitamento por hash + versão de pipeline
- Tratamento de duplicidade e `forceReprocess`
- Primeira taxonomia de erros

### Critério de saída

- Mesmo arquivo não gera nova execução compatível por padrão
- Contrato de erro estável para invalidações de entrada

## Fase 4: Worker e pipeline base

### Entregas

- Consumo da fila pelo worker
- Download do original a partir do MinIO
- Renderização por página
- OCR tradicional como engine primária
- Consolidação de texto único concatenado
- Persistência de artefatos por página

### Critério de saída

- Documento percorre a pipeline até gerar texto consolidado
- Resultado fica disponível no banco

## Fase 5: Enriquecimento semântico

### Entregas

- Detecção de campos
- Detecção de checkbox
- Detecção e marcação de manuscrito
- Marcador explícito `[ilegível]`
- Score de confiança por documento

### Critério de saída

- Resultado final deixa de ser OCR bruto e passa a ter payload enriquecido

## Fase 6: Fallback, retries e DLQ

### Entregas

- Heurísticas para decidir fallback
- Chamada controlada a LLM com mascaramento ou pseudonimização
- Retry policy por tipo de erro
- DLQ com replay manual

### Critério de saída

- Falhas recuperáveis tentam novas estratégias
- Falhas terminais são rastreáveis e reprocessáveis

## Fase 7: Result delivery e reprocessamento

### Entregas

- `GET /v1/parsing/jobs/{jobId}/result`
- `POST /v1/parsing/jobs/{jobId}/reprocess`
- Versionamento de resultado, pipeline, prompt, modelo e contrato
- RBAC e auditoria de acesso

### Critério de saída

- Resultado final consultável com histórico preservado
- Reprocessamento gera nova execução sem sobrescrever a anterior

## Fase 8: Qualidade, aceite e endurecimento

### Entregas

- Golden dataset versionado
- Testes de contrato
- Testes end-to-end
- Métricas de latência, fallback e taxa de sucesso
- Hardening de logs, retenção e criptografia em repouso

### Critério de saída

- SLA de até 30 segundos atendido no conjunto de referência
- Taxa de sucesso e qualidade medidas de forma reprodutível

## Backlog pós-MVP

- `Template Management`
- classificação por template
- pseudonimização transversal
- painel operacional
- revisão humana assistida
- novos domínios documentais

## Riscos principais

- baixa qualidade inicial de manuscrito
- latência excessiva em fallback para LLM
- acoplamento indevido entre API e worker
- crescimento prematuro do modelo antes do dataset real

## Estratégia de mitigação

- começar com OCR e heurísticas simples
- medir latência por etapa desde o início
- manter portas e adaptadores explícitos em ambos os serviços
- validar toda evolução contra golden dataset
