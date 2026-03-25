# DDD: OCR/LLM Extraction

## Objetivo

Executar a pipeline de extracao que transforma o documento em texto consolidado com marcacoes semanticas, preservando evidencias tecnicas suficientes para auditoria, tuning e reprocessamento.

## Decisoes fechadas do MVP

- OCR tradicional e a estrategia primaria
- Fallback para LLM e acionado por heuristicas
- O fallback ocorre em nivel de campo ou segmento, nao no documento inteiro por padrao
- Gatilhos iniciais de fallback: OCR vazio, baixa confianca global, manuscrito detectado, checkbox ambiguo e campos criticos ausentes
- O provedor externo inicial deve caber em `free tier` ou custo baixo, com adapters previstos para `OpenRouter` e `HuggingFace`
- Toda chamada a LLM externo exige mascaramento antes do envio
- Artefatos obrigatorios persistidos no MVP: original, render por pagina, OCR bruto, texto mascarado enviado ao LLM, prompt e resposta
- Recortes de manuscrito nao sao obrigatorios no MVP
- O payload externo do MVP e texto consolidado com marcacoes; campos estruturados ficam para fase posterior

## Agregado `ExtractionRun`

Representa a execucao concreta da pipeline para um `JobAttempt`.

### Atributos principais

- `runId`
- `jobId`
- `attemptId`
- `pipelineVersion`
- `engineSequence`
- `globalConfidence`
- `warnings`
- `status`

## Entidades internas

### `PageExtraction`

- `pageNumber`
- `renderReference`
- `rawOcrText`
- `normalizedText`
- `handwrittenSegments`
- `checkboxFindings`
- `confidenceScore`

### `FallbackTarget`

Representa um campo, trecho ou segmento elegivel para fallback.

- `targetId`
- `pageNumber`
- `targetType`
- `targetText`
- `fallbackReason`
- `maskedPromptReference`

## Regras de negocio

- A pipeline sempre comeca por renderizacao e OCR tradicional.
- A decisao de fallback precisa ser explicita e auditavel.
- Conteudo manuscrito de baixa confianca deve ser marcado, nao promovido como verdade.
- Conteudo ilegivel deve virar marcador explicito `[ilegivel]`.
- O resultado final pode ser `PARTIAL` quando existir texto consolidado utilizavel, mas incompleto.
- Assinaturas e rubricas ficam fora do escopo do MVP.

## `PARTIAL` no contexto de extracao

Classificar como `PARTIAL` quando:

- o texto consolidado foi produzido
- parte do documento ficou como `[ilegivel]`
- checkbox permaneceu ambiguo
- manuscrito ficou sem transcricao confiavel
- houve campo ou segmento critico sem recuperacao mesmo apos fallback

Classificar como `FAILED` quando:

- nao houver payload utilizavel
- o OCR falhar sem produzir texto minimamente valido
- a pipeline inteira exceder o retry permitido sem resultado aproveitavel

## Value objects

- `EngineSequence`
- `ConfidenceScore`
- `FallbackReason`
- `CheckboxState`
- `HandwritingClassification`
- `MaskedPrompt`

## Servicos de dominio

- `PageRenderingService`
- `OpticalRecognitionService`
- `HeuristicEvaluationService`
- `FieldLevelFallbackDecisionService`
- `SensitiveDataMaskingService`
- `TextConsolidationService`
- `ResultClassificationService`

## Portas

### Entrada

- `ExecuteExtractionCommand`

### Saida

- `OriginalDocumentReaderPort`
- `RenderedArtifactStoragePort`
- `RawOcrArtifactStoragePort`
- `MaskedPromptStoragePort`
- `PromptAuditStoragePort`
- `OcrEnginePort`
- `LlmExtractionPort`
- `ClockPort`

## Pipeline recomendada

1. `loadOriginalDocumentForAttempt`
2. `renderDocumentPages`
3. `extractPrintedTextFromPages`
4. `detectHandwrittenSegments`
5. `detectCheckboxFindings`
6. `evaluateFieldLevelFallbackTargets`
7. `buildMaskedPromptForLlm`
8. `mergeFallbackResponsesIntoPageText`
9. `buildConsolidatedDocumentText`
10. `classifyExtractionResult`

## Politica de dados sensiveis

- OCR interno pode operar com texto bruto
- Prompt de LLM externo deve receber texto mascarado
- Prompt e resposta precisam ser persistidos para auditoria tecnica
- Logs nunca podem carregar o texto integral enviado ao provedor externo

## Regras de clean code para este contexto

- cada etapa da pipeline deve ter entrada e saida explicitas
- evitar funcoes genericas como `runPipelineStep`; preferir `evaluateCheckboxAmbiguity` ou `mergeHandwrittenMarkersIntoText`
- heuristicas devem ficar em funcoes puras para facilitar regressao
- o adapter de LLM nao decide negocio; ele apenas executa o contrato da porta

## Plano de implementacao orientado a TDD

1. Criar testes das heuristicas de fallback em funcoes puras.
2. Criar testes do mascaramento de dados sensiveis.
3. Criar testes do `TextConsolidationService` para `[marcado]`, `[desmarcado]`, `[manuscrito]` e `[ilegivel]`.
4. Criar testes de aplicacao da pipeline basica `render -> OCR -> consolidacao`.
5. Criar testes de aplicacao do fluxo com fallback de campo.
6. Criar contract tests para OCR e LLM com fixtures pequenas e deterministicas.
7. Criar testes de aceite com amostra inicial do golden dataset.

## Cenarios de teste obrigatorios

- gera render por pagina
- persiste OCR bruto
- dispara fallback quando OCR vier vazio
- dispara fallback para checkbox ambiguo
- aplica mascaramento antes de chamar LLM
- persiste prompt e resposta do LLM
- retorna `[ilegivel]` quando nao houver transcricao confiavel
- classifica como `PARTIAL` quando o payload for utilizavel e incompleto
