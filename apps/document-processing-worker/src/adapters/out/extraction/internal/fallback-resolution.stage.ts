import type { ArtifactReference } from '@document-parser/shared-kernel';
import type {
  LlmExtractionPort,
  LlmFallbackRequest
} from '../../../../domain/extraction/extraction-ports';
import type {
  FallbackTarget,
  PageExtraction,
  RenderedPage
} from '../../../../domain/extraction/extraction.types';
import type { HeuristicEvaluationService } from '../../../../domain/extraction/heuristic-evaluation.service';
import type { SensitiveDataMaskingService } from '../../../../domain/extraction/sensitive-data-masking.service';
import type { TextConsolidationService } from '../../../../domain/extraction/text-consolidation.service';
import type { TextNormalizationService } from '../../../../domain/extraction/text-normalization.service';
import { buildUnavailableLlmResponse } from '../llm-response.utils';
import type { ArtifactReferenceFactory } from './artifact-reference.factory';

export class FallbackResolutionStage {
  public constructor(
    private readonly llmExtraction: LlmExtractionPort,
    private readonly heuristicEvaluationService: HeuristicEvaluationService,
    private readonly maskingService: SensitiveDataMaskingService,
    private readonly normalizationService: TextNormalizationService,
    private readonly textConsolidationService: TextConsolidationService,
    private readonly artifactReferenceFactory: ArtifactReferenceFactory
  ) {}

  public async resolve(input: {
    jobId: string;
    renderedPages: RenderedPage[];
    pageExtractions: PageExtraction[];
  }): Promise<{
    pageExtractions: PageExtraction[];
    fallbackTargets: FallbackTarget[];
    fallbackArtifacts: ArtifactReference[];
  }> {
    const fallbackTargets = this.heuristicEvaluationService.evaluateFallbackTargets({
      pages: input.pageExtractions,
      renderedPages: input.renderedPages
    });
    const fallbackArtifacts = await this.executeFallbackTargets(input.jobId, fallbackTargets);

    this.mergeFallbackResponsesIntoPageText(input.pageExtractions, fallbackTargets);

    return {
      pageExtractions: input.pageExtractions,
      fallbackTargets,
      fallbackArtifacts
    };
  }

  private async executeFallbackTargets(jobId: string, targets: FallbackTarget[]): Promise<ArtifactReference[]> {
    if (targets.length === 0) {
      return [];
    }

    const requests: LlmFallbackRequest[] = targets.map((target) => {
      const maskedTarget = this.maskingService.maskForExternalLlm(target.sourceText);
      const maskedText = maskedTarget.maskedText;
      const promptText = this.buildMaskedPromptForTarget(target, maskedText);
      target.maskedText = maskedText;
      target.promptText = promptText;
      target.placeholderMap = maskedTarget.placeholderMap;
      target.maskedPromptReference = this.artifactReferenceFactory.buildMaskedTextArtifact(
        jobId,
        target,
        maskedText
      );
      target.llmResponseReference = this.artifactReferenceFactory.buildResponseArtifact(
        jobId,
        target,
        '[pending]'
      );

      return {
        targetId: target.targetId,
        pageNumber: target.pageNumber,
        targetType: target.targetType,
        fallbackReason: target.fallbackReason,
        targetLocator: target.targetLocator,
        maskedText,
        promptText
      };
    });

    let responses;
    try {
      responses = await this.llmExtraction.extractTargets({ requests });
    } catch {
      responses = requests.map((request) =>
        buildUnavailableLlmResponse(request, this.llmExtraction.getModelVersion())
      );
    }

    for (const response of responses) {
      const target = targets.find((candidate) => candidate.targetId === response.targetId);
      if (target === undefined) {
        continue;
      }

      target.responseText = response.responseText;
      target.resolvedText =
        response.resolvedText === undefined
          ? undefined
          : this.maskingService.restoreMaskedText(response.resolvedText, target.placeholderMap ?? {});
      target.confidenceScore = response.confidenceScore;
      target.warning = response.warning;
      target.llmResponseReference = this.artifactReferenceFactory.buildResponseArtifact(
        jobId,
        target,
        response.responseText,
        response.resolvedText
      );
    }

    return targets.flatMap((target) => {
      const references: ArtifactReference[] = [];
      if (target.maskedPromptReference !== undefined) {
        references.push(target.maskedPromptReference);
      }
      references.push(
        this.artifactReferenceFactory.buildPromptArtifact(jobId, target, target.promptText ?? '')
      );
      if (target.llmResponseReference !== undefined) {
        references.push(target.llmResponseReference);
      }
      return references;
    });
  }

  private mergeFallbackResponsesIntoPageText(pageExtractions: PageExtraction[], targets: FallbackTarget[]): void {
    const documentTarget = targets.find((target) => target.targetType === 'DOCUMENT');

    for (const page of pageExtractions) {
      const pageTarget = targets.find(
        (target) => target.targetType === 'PAGE' && target.pageNumber === page.pageNumber
      );

      for (const segment of page.handwrittenSegments) {
        segment.resolvedText = targets.find((target) => target.targetId === segment.segmentKey)?.resolvedText;
      }
      for (const checkbox of page.checkboxFindings) {
        checkbox.resolvedText = targets.find((target) => target.targetId === checkbox.segmentKey)?.resolvedText;
      }
      for (const field of page.criticalFieldFindings) {
        field.resolvedText = targets.find((target) => target.targetId === field.segmentKey)?.resolvedText;
      }

      if (documentTarget?.resolvedText !== undefined) {
        page.enrichedText =
          page.pageNumber === 1
            ? this.normalizationService.normalizeOcrTextByPage(documentTarget.resolvedText)
            : '';
        continue;
      }

      if (pageTarget?.resolvedText !== undefined) {
        page.enrichedText = this.normalizationService.normalizeOcrTextByPage(pageTarget.resolvedText);
        continue;
      }

      if (page.rawOcrText.trim() === '' && pageTarget?.resolvedText === undefined) {
        page.enrichedText = '[ilegivel]';
        continue;
      }

      page.enrichedText = this.textConsolidationService.mergeFallbackResponsesIntoPageText(page);
    }
  }

  private buildMaskedPromptForTarget(target: FallbackTarget, maskedText: string): string {
    return [
      'Recover the best possible text for this OCR fallback target.',
      `target_id=${target.targetId}`,
      `target_type=${target.targetType}`,
      `fallback_reason=${target.fallbackReason}`,
      `page_number=${target.pageNumber ?? 0}`,
      `locator=${JSON.stringify(target.targetLocator)}`,
      'Preserve placeholders like [cpf_1], [phone_1] and [email_1] exactly as given.',
      'masked_source_text:',
      maskedText,
      'Return only the recovered text or [ilegivel].'
    ].join('\n');
  }
}
