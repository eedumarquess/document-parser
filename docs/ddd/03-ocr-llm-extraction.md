# DDD: OCR/LLM Extraction

## Objetivo

Executar no `document-processing-worker` a pipeline que transforma o documento original ja aceito em texto consolidado com marcacoes semanticas, produz evidencias tecnicas por pagina e devolve um `ProcessingOutcome` auditavel para fechamento do `JobAttempt`.

## Decisoes fechadas do MVP

- `OCR tradicional` e a estrategia primaria
- `fallback` para `LLM` e acionado por heuristicas explicitas e versionadas
- `fallback` ocorre por `segmento` ou `campo` interno, nao por documento inteiro por padrao
- `fallback` em nivel de documento inteiro so e aceitavel quando o `OCR` vier vazio ou inutilizavel em todas as paginas
- o binario original entra neste contexto como entrada ja persistida por `Ingestion`; ele nao e regravado aqui
- o provedor externo inicial deve caber em `free tier` ou custo baixo, com adapters previstos para `OpenRouter` e `HuggingFace`
- toda chamada a `LLM` externo exige mascaramento antes do envio
- artefatos obrigatorios persistidos no alvo do MVP: render por pagina, `OCR` bruto, texto mascarado enviado ao `LLM`, prompt e resposta
- recortes de manuscrito nao sao obrigatorios no MVP
- o payload externo do MVP continua sendo texto consolidado com marcacoes; campos estruturados ficam para fase posterior
- `confidence` em nivel de documento e obrigatoria no MVP; `confidence` por alvo fica como capacidade interna evolutiva
- assinaturas e rubricas ficam fora do escopo do MVP

## Fronteira e ownership do contexto

- `Ingestion` e dono do aceite do arquivo, do `Document` e da persistencia do original
- `Document Processing` e dono do ciclo de vida de `ProcessingJob` e `JobAttempt`, incluindo retry, `DLQ` e estados finais
- `OCR/LLM Extraction` e dono de renderizacao por pagina, `OCR`, heuristicas, fallback direcionado, consolidacao textual e producao de evidencias tecnicas
- no MVP nao existe uma colecao canonica separada para `ExtractionRun`; a execucao de extracao fica acoplada `1:1` ao `JobAttempt` atual

## Modelo de dominio

### Colaboracao com `JobAttempt`

Cada execucao de extracao existe acoplada `1:1` a um `JobAttempt`.

Campos tecnicos da execucao que ja pertencem ao modelo canonico compartilhado:

- `attemptId`
- `jobId`
- `pipelineVersion`
- `fallbackUsed`
- `fallbackReason`
- `normalizationVersion`
- `promptVersion`
- `modelVersion`
- `startedAt`
- `finishedAt`
- `latencyMs`
- `status`

Este contexto nao concorre com `Document Processing` criando outro agregado de ciclo de vida. Ele produz um `ProcessingOutcome` que alimenta `ProcessingResult` e fecha o `JobAttempt`.

### Objeto de saida `ProcessingOutcome`

Representa o contrato interno minimo que a pipeline precisa devolver ao worker.

#### Atributos principais

- `status`
- `engineUsed`
- `confidence`
- `warnings`
- `payload`
- `artifacts`
- `fallbackUsed`
- `promptVersion`
- `modelVersion`
- `normalizationVersion`
- `totalLatencyMs`

`ProcessingOutcome` so existe para saidas utilizaveis, portanto seu `status` e apenas `COMPLETED` ou `PARTIAL`.

### Entidade interna `PageExtraction`

- `pageNumber`
- `renderReference`
- `rawOcrReference`
- `rawOcrText`
- `normalizedText`
- `handwrittenSegments`
- `checkboxFindings`
- `confidenceScore`

### Entidade interna `FallbackTarget`

Representa um recorte elegivel para reavaliacao controlada por `LLM`.

- `targetId`
- `pageNumber`
- `targetType`
- `targetLocator`
- `sourceText`
- `fallbackReason`
- `isCritical`
- `maskedPromptReference`
- `llmResponseReference`
- `resolvedText`
- `confidenceScore`

## Linguagem ubiqua operacional

| Termo | Significado |
| --- | --- |
| `segmento` | Recorte local de texto ou imagem que pode ser reavaliado isoladamente, por exemplo linha, bloco, grupo de checkbox ou trecho manuscrito |
| `campo` | Ancora interna nomeada pela pipeline para um par `label -> valor` ou regiao equivalente; nao e o contrato publico final |
| `campo critico` | Campo interno versionado cuja ausencia degrada materialmente a qualidade; no MVP so existe quando a lista for explicita na `pipelineVersion`, nunca por inferencia ad hoc |
| `checkbox ambiguo` | Achado em que a pipeline nao consegue afirmar com seguranca `[marcado]` ou `[desmarcado]` |
| `manuscrito detectado` | Segmento cuja classificacao visual indica escrita manual e exige tratamento proprio |
| `texto consolidado` | Payload textual unico, orientado a cobertura semantica, nao a fidelidade perfeita da ordem visual |
| `evidencia tecnica` | Artefato persistido para auditoria, tuning, comparacao em testes e reprocessamento |

## Regras de negocio

- A pipeline sempre comeca carregando o original ja persistido por `Ingestion`.
- A pipeline sempre passa por renderizacao por pagina e `OCR tradicional` antes de considerar fallback.
- Normalizacao textual precisa ser etapa explicita antes de heuristicas e consolidacao.
- A decisao de fallback precisa ser explicita, versionada e auditavel por `FallbackTarget`.
- O fallback padrao e direcionado por alvo; nao deve promover um `LLM` para reprocessar o documento inteiro sem gatilho forte.
- Conteudo manuscrito de baixa confianca deve ser marcado, nao promovido como verdade.
- Conteudo ilegivel deve virar marcador explicito `[ilegivel]`.
- `checkbox ambiguo` nao pode ser promovido para `[marcado]` nem `[desmarcado]` sem evidencia suficiente.
- Se um `LLM` falhar para um alvo, a pipeline deve preservar o melhor texto disponivel e emitir `warning` quando ainda houver payload global utilizavel.
- `promptVersion`, `modelVersion` e `normalizationVersion` precisam acompanhar o resultado quando usados.
- Latencia e custo estimado de fallback externo devem ser atribuiveis ao `attempt` quando aplicavel.

## Taxonomias iniciais

### Razoes iniciais de fallback

- `OCR_EMPTY`
- `LOW_GLOBAL_CONFIDENCE`
- `HANDWRITING_DETECTED`
- `CHECKBOX_AMBIGUOUS`
- `CRITICAL_TARGET_MISSING`

### Warnings iniciais

- `ILLEGIBLE_CONTENT`
- `HANDWRITING_LOW_CONFIDENCE`
- `AMBIGUOUS_CHECKBOX`
- `LLM_FALLBACK_UNAVAILABLE`
- `PARTIAL_TARGET_RECOVERY`

## Relacao entre `ProcessingOutcome`, `PARTIAL` e `FAILED`

`ProcessingOutcome` so cobre `COMPLETED` e `PARTIAL`.

Classificar como `PARTIAL` quando:

- o texto consolidado foi produzido
- parte do documento ficou como `[ilegivel]`
- um `checkbox` permaneceu ambiguo
- um trecho manuscrito ficou sem transcricao confiavel
- houve `FallbackTarget` critico sem recuperacao completa, mas o payload global permaneceu utilizavel
- houve `warning` relevante sem invalidar o documento inteiro

Classificar como `FAILED` quando:

- nao houver payload utilizavel apos `OCR` e fallbacks permitidos
- renderizacao ou `OCR` falharem de modo a nao deixar texto minimamente aproveitavel
- a tentativa exceder o budget de tempo e `Document Processing` fechar o `attempt` como `TIMED_OUT` ou `FAILED`

`FAILED`, `TIMED_OUT` e `MOVED_TO_DLQ` continuam pertencendo ao contexto de `Document Processing`, nao ao contrato de `ProcessingOutcome`.

## Value objects

- `EngineSequence`
- `ConfidenceScore`
- `FallbackReason`
- `CheckboxState`
- `HandwritingClassification`
- `MaskedPrompt`
- `TargetLocator`
- `ExtractionWarning`

## Servicos de dominio

- `PageRenderingService`
- `OpticalRecognitionService`
- `TextNormalizationService`
- `HeuristicEvaluationService`
- `FieldLevelFallbackDecisionService`
- `SensitiveDataMaskingService`
- `TargetedLlmFallbackService`
- `TextConsolidationService`
- `ProcessingOutcomePolicy`

## Portas

### Entrada

- `ProcessJobMessageCommand`

### Saida alvo da pipeline

- `OriginalDocumentReaderPort`
- `PageRendererPort`
- `OcrEnginePort`
- `LlmExtractionPort`
- `RenderedArtifactWriterPort`
- `RawOcrArtifactWriterPort`
- `PromptArtifactWriterPort`
- `LlmResponseArtifactWriterPort`
- `ClockPort`

No estado atual do repositorio, parte dessas responsabilidades ainda esta agregada em `BinaryStoragePort`, `PageArtifactRepositoryPort` e `ExtractionPipelinePort`.

## Pipeline recomendada

| Etapa | Entrada principal | Saida principal |
| --- | --- | --- |
| `loadOriginalDocumentForAttempt` | `document.storageReference`, `jobId`, `attemptId` | binario original e metadados do documento |
| `renderDocumentPages` | binario original | imagens por pagina |
| `extractRawOcrFromPages` | imagens por pagina | `OCR` bruto por pagina |
| `normalizeOcrTextByPage` | `OCR` bruto por pagina | `PageExtraction.normalizedText` |
| `detectHandwrittenSegments` | imagem + texto normalizado | segmentos manuscritos anotados |
| `detectCheckboxFindings` | imagem + texto normalizado | estados de `checkbox` por pagina |
| `evaluateFallbackTargets` | paginas normalizadas + heuristicas | lista de `FallbackTarget` |
| `buildMaskedPromptForTargets` | `FallbackTarget` | prompt mascarado por alvo ou lote |
| `executeTargetedLlmFallback` | prompt mascarado | respostas do `LLM` por alvo |
| `mergeFallbackResponsesIntoPageText` | `PageExtraction` + respostas | texto por pagina enriquecido |
| `buildConsolidatedDocumentText` | paginas enriquecidas | `payload` textual unico |
| `calculateConfidenceAndWarnings` | paginas + alvos + consolidado | `confidence` global e `warnings` |
| `buildProcessingOutcome` | consolidado + metadados tecnicos | `ProcessingOutcome` final |

## Politica de dados sensiveis

- `OCR` interno pode operar com texto bruto
- `LLM` externo deve receber apenas texto mascarado
- prompt e resposta precisam ser persistidos para auditoria tecnica
- logs nunca podem carregar o texto integral enviado ao provedor externo
- qualquer payload auditado precisa passar por redacao antes de ser persistido fora dos artefatos tecnicos
- o original nao deve ser duplicado por este contexto; ele continua referenciado pelo `Document`

## Contrato minimo do texto consolidado

Marcadores textuais aceitos no MVP:

| Marcador | Significado |
| --- | --- |
| `[marcado]` | `checkbox` identificado como marcado com confianca suficiente |
| `[desmarcado]` | `checkbox` identificado como desmarcado com confianca suficiente |
| `[manuscrito]` | trecho cuja origem e manuscrita e que pode preceder uma transcricao recuperada |
| `[ilegivel]` | trecho sem transcricao confiavel |

Regras adicionais:

- `checkbox ambiguo` deve gerar `warning`; nao deve ser promovido para `[marcado]` nem `[desmarcado]`
- o payload deve priorizar cobertura semantica do documento, mesmo que a ordem visual nao seja perfeita em tabelas e caixas
- a pipeline nao deve inventar valores plausiveis quando a evidencia for insuficiente

Exemplo de saida textual valida:

```text
Paciente consciente. Checkbox febre: [marcado]. Observacao manuscrita: [manuscrito] Dor ha 2 dias. Assinatura: fora do escopo. Trecho final: [ilegivel].
```

## Estado atual no repositorio

O contexto de `OCR/LLM Extraction` ja tem uma base funcional no `document-processing-worker`:

- `ProcessJobMessageUseCase` ja carrega `job`, `document` e `attempt`, inicia a tentativa, executa a extracao, persiste `ProcessingResult`, persiste artefatos e registra auditoria
- `ProcessingResultEntity` ja monta o resultado canonicamente a partir de `ProcessingOutcome`, incluindo `compatibilityKey`, `confidence`, `warnings` e versoes tecnicas
- `ProcessingOutcomePolicy` ja classifica `PARTIAL` quando o payload contem `[ilegivel]` ou quando existir qualquer `warning`
- existe adapter padrao `SimulatedDocumentExtractionAdapter`, atras de `ExtractionPipelinePort`, para sustentar testes de aplicacao, contrato e `E2E`
- o adapter simulado ja persiste `RENDERED_IMAGE`, `OCR_JSON` e `MASKED_TEXT`

Os gaps mais relevantes para fechar este contexto contra o desenho alvo deste documento sao:

- a pipeline real ainda esta colapsada em uma unica porta `ExtractionPipelinePort`, sem etapas nomeadas para renderizacao, `OCR`, mascaramento e fallback
- ainda nao existe representacao explicita de `PageExtraction` e `FallbackTarget` no codigo
- `fallbackReason`, `warning` e `targetLocator` ainda nao possuem taxonomia canonica no worker
- o repositorio ainda nao persiste prompt e resposta como artefatos tecnicos dedicados
- ainda nao existe `LLM` real em nivel de alvo nem agregacao de `confidence` por pagina ou por alvo
- ainda nao existe golden dataset cobrindo decisao de fallback, manuscrito e marcadores semanticos

## Plano de implementacao orientado ao estado atual

### Etapa 1: alinhar linguagem ubiqua e contratos

1. Formalizar `segmento`, `campo`, `campo critico`, `checkbox ambiguo`, `targetType` e `targetLocator`.
2. Assumir explicitamente que a execucao fica `1:1` com `JobAttempt`, sem criar agregado canonico paralelo para `ExtractionRun` no MVP.
3. Fechar a taxonomia inicial de `FallbackReason` e `ExtractionWarning`.
4. Definir a estrategia de persistencia de prompt e resposta do `LLM`, inclusive se exigira novos `ArtifactType` ou `metadata` dedicados.

### Etapa 2: decompor a pipeline simulada em passos nomeados

1. Refatorar `ExtractionPipelinePort` para uma composicao interna com etapas nomeadas e testaveis.
2. Introduzir `TextNormalizationService`, `FieldLevelFallbackDecisionService`, `SensitiveDataMaskingService` e `TextConsolidationService` como unidades separadas.
3. Tornar explicito o ponto em que `ProcessingOutcomePolicy` decide `COMPLETED` ou `PARTIAL`.
4. Manter `provider SDK`, formato de prompt e detalhes de API externos somente nos adapters.

### Etapa 3: implementar adapters reais do MVP

1. Criar adapter de renderizacao por pagina para `PDF`, `JPEG` e `PNG`.
2. Criar adapter real de `OCR`.
3. Criar adapter real de `LLM` para fallback direcionado, com mascaramento obrigatorio antes da chamada.
4. Persistir render, `OCR` bruto, texto mascarado, prompt e resposta como evidencias tecnicas.
5. Medir latencia e custo estimado por `attempt` quando houver chamada externa.

### Etapa 4: fechar a cobertura de testes que falta

1. Criar testes de dominio das heuristicas de fallback em funcoes puras.
2. Criar testes de normalizacao e consolidacao textual para `[marcado]`, `[desmarcado]`, `[manuscrito]` e `[ilegivel]`.
3. Criar contract tests do adapter de `OCR` e do adapter de `LLM` com fixtures pequenas e deterministicas.
4. Criar testes de aplicacao do fluxo com fallback por alvo e do fluxo sem fallback.
5. Criar aceite com golden dataset versionado para manuscrito, `checkbox`, tabelas simples e conteudo ilegivel.

### Etapa 5: criterio de pronto do contexto

O contexto de `OCR/LLM Extraction` pode ser considerado fechado no MVP quando todos os itens abaixo forem verdadeiros:

- o worker le o original persistido por `Ingestion` e nao o duplica
- cada pagina gera render e `OCR` bruto persistidos como evidencia tecnica
- a decisao de fallback e explicita por alvo e auditavel
- chamadas externas usam mascaramento antes do envio
- prompt e resposta do `LLM` ficam persistidos para auditoria tecnica
- o texto consolidado usa a gramatica minima de marcadores deste documento
- `ProcessingOutcome` devolve `confidence`, `warnings`, `payload`, `artifacts` e versoes tecnicas coerentes
- quando nao houver payload utilizavel, o worker nao fabrica `ProcessingOutcome`; o fechamento segue a trilha de falha de `Document Processing`
- existe cobertura de dominio, aplicacao, contrato e aceite por golden dataset para os casos criticos do MVP

## Regras de clean code para este contexto

- cada etapa da pipeline deve ter entrada e saida explicitas
- heuristicas devem ficar em funcoes puras para facilitar regressao
- o adapter de `LLM` nao decide negocio; ele apenas executa o contrato da porta
- `OCR` bruto, storage e formatos de provider nao entram no dominio como detalhe estrutural
- evitar funcoes genericas como `runPipelineStep`; preferir nomes como `normalizeOcrTextByPage`, `identifyCheckboxAmbiguity`, `decideFallbackTargets` e `mergeFallbackResponsesIntoPageText`

## Cenarios de teste obrigatorios

- gera render por pagina
- persiste `OCR` bruto
- normaliza texto antes da consolidacao
- dispara fallback quando o `OCR` vier vazio
- dispara fallback para `checkbox ambiguo`
- nao dispara fallback quando o `OCR` ja for suficiente
- aplica mascaramento antes de chamar `LLM`
- persiste prompt e resposta do `LLM`
- retorna `[ilegivel]` quando nao houver transcricao confiavel
- classifica como `PARTIAL` quando o payload for utilizavel e incompleto
- nao fabrica `ProcessingOutcome` de sucesso quando nao houver payload utilizavel

## Anti-corruption rules

- mensagem de fila nao entra no dominio como detalhe estrutural; ela e apenas traducao do adapter de entrada
- `SDK`, nome comercial de modelo e formato de resposta do provedor ficam restritos ao adapter de `LLM`
- convencoes de `bucket`, `objectKey` e `metadata` de storage nao entram nas heuristicas de negocio
- schema bruto do `OCR` nao pode vazar para `TextConsolidationService` ou `ProcessingOutcomePolicy`
