import {
  ExtractionWarning,
  FallbackReason,
  FatalFailureError,
  JobStatus
} from '@document-parser/shared-kernel';
import type { LlmExtractionPort } from '../../src/domain/extraction/extraction-ports';
import { HeuristicEvaluationService } from '../../src/domain/extraction/heuristic-evaluation.service';
import { SensitiveDataMaskingService } from '../../src/domain/extraction/sensitive-data-masking.service';
import { TextConsolidationService } from '../../src/domain/extraction/text-consolidation.service';
import { TextNormalizationService } from '../../src/domain/extraction/text-normalization.service';
import { ProcessingOutcomePolicy } from '../../src/domain/policies/processing-outcome.policy';
import { ArtifactReferenceFactory } from '../../src/adapters/out/extraction/internal/artifact-reference.factory';
import { FallbackResolutionStage } from '../../src/adapters/out/extraction/internal/fallback-resolution.stage';
import { OutcomeAssemblyStage } from '../../src/adapters/out/extraction/internal/outcome-assembly.stage';

const createPageExtraction = (input: {
  pageNumber: number;
  rawOcrText: string;
  normalizedText: string;
  confidenceScore: number;
}) => ({
  pageNumber: input.pageNumber,
  renderReference: {
    artifactId: `render-${input.pageNumber}`,
    artifactType: 'RENDERED_IMAGE' as const,
    storageBucket: 'artifacts',
    storageObjectKey: `render/job/page-${input.pageNumber}.png`,
    mimeType: 'image/png',
    pageNumber: input.pageNumber
  },
  rawOcrReference: {
    artifactId: `ocr-${input.pageNumber}`,
    artifactType: 'OCR_JSON' as const,
    storageBucket: 'artifacts',
    storageObjectKey: `ocr/job/page-${input.pageNumber}.json`,
    mimeType: 'application/json',
    pageNumber: input.pageNumber
  },
  rawOcrText: input.rawOcrText,
  normalizedText: input.normalizedText,
  handwrittenSegments: [],
  checkboxFindings: [],
  criticalFieldFindings: [],
  confidenceScore: input.confidenceScore
});

describe('FallbackResolutionStage', () => {
  const normalization = new TextNormalizationService();
  const heuristic = new HeuristicEvaluationService(normalization);
  const artifacts = new ArtifactReferenceFactory();
  const textConsolidation = new TextConsolidationService();

  it('creates an OCR_EMPTY fallback and keeps the page illegible when LLM is unavailable', async () => {
    const llmUnavailable: LlmExtractionPort = {
      async extractTargets(): Promise<never> {
        throw new Error('llm unavailable');
      },
      getModelVersion(): string {
        return 'llm-test';
      }
    };
    const stage = new FallbackResolutionStage(
      llmUnavailable,
      heuristic,
      new SensitiveDataMaskingService(),
      normalization,
      textConsolidation,
      artifacts
    );

    const resolved = await stage.resolve({
      jobId: 'job-1',
      renderedPages: [{ pageNumber: 1, mimeType: 'image/png', sourceText: 'pagina 1 sem OCR' }],
      pageExtractions: [createPageExtraction({ pageNumber: 1, rawOcrText: '', normalizedText: '', confidenceScore: 0.2 })]
    });

    expect(resolved.fallbackTargets).toEqual([
      expect.objectContaining({
        targetType: 'DOCUMENT',
        fallbackReason: FallbackReason.OCR_EMPTY,
        warning: ExtractionWarning.LLM_FALLBACK_UNAVAILABLE
      })
    ]);
    expect(resolved.pageExtractions[0].enrichedText).toBe('[ilegivel]');
    expect(resolved.fallbackArtifacts).toHaveLength(3);
  });

  it('resolves a LOW_GLOBAL_CONFIDENCE page fallback into enriched page text', async () => {
    const llmSuccess: LlmExtractionPort = {
      async extractTargets() {
        return [
          {
            targetId: 'page-1-low-confidence',
            responseText: 'texto revisado',
            resolvedText: 'texto revisado',
            confidenceScore: 0.81
          }
        ];
      },
      getModelVersion(): string {
        return 'llm-test';
      }
    };
    const stage = new FallbackResolutionStage(
      llmSuccess,
      heuristic,
      new SensitiveDataMaskingService(),
      normalization,
      textConsolidation,
      artifacts
    );

    const resolved = await stage.resolve({
      jobId: 'job-1',
      renderedPages: [
        { pageNumber: 1, mimeType: 'image/png', sourceText: 'texto revisado' },
        { pageNumber: 2, mimeType: 'image/png', sourceText: 'texto confiavel' }
      ],
      pageExtractions: [
        createPageExtraction({
          pageNumber: 1,
          rawOcrText: 'texto ruim',
          normalizedText: 'texto ruim',
          confidenceScore: 0.2
        }),
        createPageExtraction({
          pageNumber: 2,
          rawOcrText: 'texto confiavel',
          normalizedText: 'texto confiavel',
          confidenceScore: 0.95
        })
      ]
    });

    expect(resolved.fallbackTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: 'PAGE',
          fallbackReason: FallbackReason.LOW_GLOBAL_CONFIDENCE
        })
      ])
    );
    expect(resolved.pageExtractions[0].enrichedText).toBe('texto revisado');
  });
});

describe('OutcomeAssemblyStage', () => {
  it('fails when no useful payload survives OCR and fallback processing', () => {
    const llmPort: LlmExtractionPort = {
      async extractTargets() {
        return [];
      },
      getModelVersion(): string {
        return 'llm-test';
      }
    };
    const stage = new OutcomeAssemblyStage(
      new ProcessingOutcomePolicy(),
      new HeuristicEvaluationService(new TextNormalizationService()),
      new TextConsolidationService(),
      llmPort
    );

    expect(() =>
      stage.assemble({
        jobId: 'job-1',
        attemptId: 'attempt-1',
        pageExtractions: [
          {
            ...createPageExtraction({
              pageNumber: 1,
              rawOcrText: '',
              normalizedText: '',
              confidenceScore: 0.1
            }),
            enrichedText: '[ilegivel] [manuscrito]'
          }
        ],
        fallbackTargets: [],
        fallbackArtifacts: []
      })
    ).toThrow(FatalFailureError);
  });

  it('keeps fallback-unavailable outcomes as PARTIAL when there is still usable text', () => {
    const llmPort: LlmExtractionPort = {
      async extractTargets() {
        return [];
      },
      getModelVersion(): string {
        return 'llm-test';
      }
    };
    const stage = new OutcomeAssemblyStage(
      new ProcessingOutcomePolicy(),
      new HeuristicEvaluationService(new TextNormalizationService()),
      new TextConsolidationService(),
      llmPort
    );

    const outcome = stage.assemble({
      jobId: 'job-1',
      attemptId: 'attempt-1',
      pageExtractions: [
        {
          ...createPageExtraction({
            pageNumber: 1,
            rawOcrText: 'conteudo base',
            normalizedText: 'conteudo base',
            confidenceScore: 0.9
          }),
          enrichedText: 'conteudo base [ilegivel]'
        }
      ],
      fallbackTargets: [
        {
          targetId: 'page-1-ocr-empty',
          pageNumber: 1,
          targetType: 'PAGE',
          targetLocator: { locatorType: 'PAGE', pageNumber: 1 },
          sourceText: 'conteudo base',
          fallbackReason: FallbackReason.OCR_EMPTY,
          isCritical: true,
          confidenceScore: 0.2,
          warning: ExtractionWarning.LLM_FALLBACK_UNAVAILABLE
        }
      ],
      fallbackArtifacts: []
    });

    expect(outcome.status).toBe(JobStatus.PARTIAL);
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([
        ExtractionWarning.ILLEGIBLE_CONTENT,
        ExtractionWarning.LLM_FALLBACK_UNAVAILABLE
      ])
    );
  });
});
