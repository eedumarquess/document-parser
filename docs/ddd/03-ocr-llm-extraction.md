# DDD: OCR/LLM Extraction

## Objetivo

Extrair informação útil do documento por uma pipeline plugável, distinguindo texto impresso, manuscrito, checkbox, campos e trechos ilegíveis.

## Responsabilidades

- Renderizar o documento por página
- Executar OCR primário
- Aplicar heurísticas de validação
- Acionar fallback para LLM quando necessário
- Produzir payload estruturado e texto consolidado
- Registrar evidências por página para debug e melhoria futura

## Agregado principal

### `ExtractionRun`

Representa a execução concreta da pipeline de extração sobre um documento.

#### Atributos principais

- `runId`
- `jobId`
- `pagePlan`
- `engineSequence`
- `pipelineVersion`
- `confidenceScore`
- `warnings`
- `status`

## Entidades internas relevantes

### `PageExtraction`

- `pageNumber`
- `renderArtifact`
- `ocrText`
- `normalizedText`
- `checkboxes`
- `handwrittenSegments`
- `illegibleSegments`
- `confidenceScore`

### `FieldExtraction`

- `fieldName`
- `value`
- `sourceType`
- `confidenceScore`
- `normalizationStatus`

## Regras de negócio

- OCR tradicional é a primeira estratégia padrão
- Fallback para LLM só ocorre após validação heurística indicar necessidade
- Manuscrito de baixa confiança não deve ser promovido como dado confiável
- Conteúdo ilegível deve virar marcador explícito `[ilegível]`
- Assinaturas e rubricas ficam fora do escopo do MVP

## Value objects

- `EngineSequence`
- `ConfidenceScore`
- `BoundingBox`
- `ExtractedField`
- `CheckboxState`
- `HandwritingClassification`

## Serviços de domínio

- `PageRenderingService`
- `OpticalRecognitionService`
- `HeuristicValidationService`
- `FallbackDecisionService`
- `NormalizationService`
- `ConfidenceScoringService`

## Repositórios

- `PageArtifactRepository`
- `HandwrittenSegmentRepository`
- `ProcessingResultRepository`

## Eventos de domínio

- `PageRendered`
- `OcrCompleted`
- `HeuristicValidationFailed`
- `LlmFallbackRequested`
- `HandwrittenSegmentDetected`
- `IllegibleSegmentDetected`
- `ExtractionCompleted`

## Portas

### Entrada

- `ExecuteExtractionCommand`

### Saída

- `OriginalDocumentReaderPort`
- `RenderedArtifactStoragePort`
- `OcrEnginePort`
- `LlmExtractionPort`
- `NormalizationRulesPort`

## Política de dados sensíveis

- OCR interno pode operar com texto bruto
- Qualquer chamada a LLM externo deve receber prompt mascarado ou pseudonimizado
