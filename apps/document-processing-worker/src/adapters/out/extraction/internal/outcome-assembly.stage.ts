import {
  DEFAULT_NORMALIZATION_VERSION,
  DEFAULT_PROMPT_VERSION,
  FatalFailureError,
  type ArtifactReference,
  type ProcessingOutcome
} from '@document-parser/shared-kernel';
import type { LlmExtractionPort } from '../../../../domain/extraction/extraction-ports';
import type {
  FallbackTarget,
  PageExtraction
} from '../../../../domain/extraction/extraction.types';
import type { HeuristicEvaluationService } from '../../../../domain/extraction/heuristic-evaluation.service';
import type { TextConsolidationService } from '../../../../domain/extraction/text-consolidation.service';
import type { ProcessingOutcomePolicy } from '../../../../domain/policies/processing-outcome.policy';

export class OutcomeAssemblyStage {
  public constructor(
    private readonly outcomePolicy: ProcessingOutcomePolicy,
    private readonly heuristicEvaluationService: HeuristicEvaluationService,
    private readonly textConsolidationService: TextConsolidationService,
    private readonly llmExtraction: LlmExtractionPort
  ) {}

  public assemble(input: {
    jobId: string;
    attemptId: string;
    pageExtractions: PageExtraction[];
    fallbackTargets: FallbackTarget[];
    fallbackArtifacts: ArtifactReference[];
  }): ProcessingOutcome {
    const payload = this.textConsolidationService.buildConsolidatedDocumentText(input.pageExtractions);

    if (!this.hasUsablePayload(payload)) {
      throw new FatalFailureError('No usable payload after OCR and allowed fallbacks', {
        jobId: input.jobId,
        attemptId: input.attemptId
      });
    }

    const { confidence, warnings } = this.heuristicEvaluationService.calculateConfidenceAndWarnings({
      pages: input.pageExtractions,
      targets: input.fallbackTargets,
      payload
    });
    const status = this.outcomePolicy.decide({
      payload,
      warnings
    });
    const artifacts = [
      ...input.pageExtractions.map((page) => page.renderReference),
      ...input.pageExtractions.map((page) => page.rawOcrReference),
      ...input.fallbackArtifacts
    ];
    const fallbackUsed = input.fallbackTargets.length > 0;

    return {
      status,
      engineUsed: fallbackUsed ? 'OCR+LLM' : 'OCR',
      confidence,
      warnings,
      payload,
      artifacts,
      fallbackUsed,
      fallbackReason: input.fallbackTargets[0]?.fallbackReason,
      promptVersion: fallbackUsed ? DEFAULT_PROMPT_VERSION : undefined,
      modelVersion: fallbackUsed ? this.llmExtraction.getModelVersion() : undefined,
      normalizationVersion: DEFAULT_NORMALIZATION_VERSION,
      totalLatencyMs: this.calculateLatencyMs(
        input.pageExtractions.length,
        input.fallbackTargets.length,
        artifacts.length
      )
    };
  }

  private hasUsablePayload(payload: string): boolean {
    if (payload.includes('[marcado]') || payload.includes('[desmarcado]')) {
      return true;
    }

    const textWithoutNonInformativeMarkers = payload
      .replaceAll('[ilegivel]', ' ')
      .replaceAll('[manuscrito]', ' ')
      .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();

    return textWithoutNonInformativeMarkers.length > 0;
  }

  private calculateLatencyMs(pageCount: number, fallbackTargets: number, artifactCount: number): number {
    return pageCount * 320 + fallbackTargets * 880 + artifactCount * 20;
  }
}
