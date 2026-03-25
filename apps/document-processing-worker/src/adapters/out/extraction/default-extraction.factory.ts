import type { WorkerProviderOverrides } from '../../../app.module';
import { HeuristicEvaluationService } from '../../../domain/extraction/heuristic-evaluation.service';
import { SensitiveDataMaskingService } from '../../../domain/extraction/sensitive-data-masking.service';
import { TextConsolidationService } from '../../../domain/extraction/text-consolidation.service';
import { TextNormalizationService } from '../../../domain/extraction/text-normalization.service';
import type { ProcessingOutcomePolicy } from '../../../domain/policies/processing-outcome.policy';
import { DefaultPageRendererAdapter } from './default-page-renderer.adapter';
import { DeterministicOcrEngineAdapter } from './deterministic-ocr-engine.adapter';
import { HuggingFaceLlmExtractionAdapter } from './huggingface-llm-extraction.adapter';
import { ArtifactReferenceFactory } from './internal/artifact-reference.factory';
import { FallbackResolutionStage } from './internal/fallback-resolution.stage';
import { OutcomeAssemblyStage } from './internal/outcome-assembly.stage';
import { PageExtractionStage } from './internal/page-extraction.stage';
import { LocalHeuristicLlmExtractionAdapter } from './local-heuristic-llm-extraction.adapter';
import { OcrLlmExtractionPipelineAdapter } from './ocr-llm-extraction.pipeline.adapter';
import { OpenRouterLlmExtractionAdapter } from './openrouter-llm-extraction.adapter';

export function createDefaultExtractionPipeline(
  policy: ProcessingOutcomePolicy,
  overrides: WorkerProviderOverrides = {}
): OcrLlmExtractionPipelineAdapter {
  const normalization = new TextNormalizationService();
  const artifactReferenceFactory = new ArtifactReferenceFactory();
  const pageRenderer = overrides.pageRenderer ?? new DefaultPageRendererAdapter();
  const ocrEngine = overrides.ocrEngine ?? new DeterministicOcrEngineAdapter();
  const llmExtraction = overrides.llmExtraction ?? createConfiguredLlmExtractionPort();
  const heuristicEvaluationService = new HeuristicEvaluationService(normalization);
  const textConsolidationService = new TextConsolidationService();

  return new OcrLlmExtractionPipelineAdapter(
    new PageExtractionStage(
      pageRenderer,
      ocrEngine,
      normalization,
      heuristicEvaluationService,
      artifactReferenceFactory
    ),
    new FallbackResolutionStage(
      llmExtraction,
      heuristicEvaluationService,
      new SensitiveDataMaskingService(),
      normalization,
      textConsolidationService,
      artifactReferenceFactory
    ),
    new OutcomeAssemblyStage(
      policy,
      heuristicEvaluationService,
      textConsolidationService,
      llmExtraction
    )
  );
}

function createConfiguredLlmExtractionPort() {
  const localFallback = new LocalHeuristicLlmExtractionAdapter();

  if ((process.env.HUGGINGFACE_API_KEY ?? '').trim() !== '') {
    return new HuggingFaceLlmExtractionAdapter(
      {
        apiKey: process.env.HUGGINGFACE_API_KEY,
        model: process.env.HUGGINGFACE_MODEL ?? 'tgi',
        baseUrl: process.env.HUGGINGFACE_BASE_URL
      },
      fetch,
      localFallback
    );
  }

  if ((process.env.OPENROUTER_API_KEY ?? '').trim() !== '') {
    return new OpenRouterLlmExtractionAdapter(
      {
        apiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
        baseUrl: process.env.OPENROUTER_BASE_URL,
        siteUrl: process.env.OPENROUTER_SITE_URL,
        appName: process.env.OPENROUTER_APP_NAME ?? '@document-parser/document-processing-worker'
      },
      fetch,
      localFallback
    );
  }

  return localFallback;
}
