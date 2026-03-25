import { Injectable } from '@nestjs/common';
import {
  ArtifactType,
  DEFAULT_NORMALIZATION_VERSION,
  DEFAULT_PROMPT_VERSION,
  FatalFailureError,
  TransientFailureError,
  type ArtifactReference,
  type ProcessingOutcome
} from '@document-parser/shared-kernel';
import type { ExtractionPipelinePort } from '../../../contracts/ports';
import type {
  LlmExtractionPort,
  LlmFallbackRequest,
  PageRendererPort,
  OcrEnginePort
} from '../../../domain/extraction/extraction-ports';
import type { FallbackTarget, PageExtraction, RenderedPage } from '../../../domain/extraction/extraction.types';
import { HeuristicEvaluationService } from '../../../domain/extraction/heuristic-evaluation.service';
import { SensitiveDataMaskingService } from '../../../domain/extraction/sensitive-data-masking.service';
import { TextConsolidationService } from '../../../domain/extraction/text-consolidation.service';
import { TextNormalizationService } from '../../../domain/extraction/text-normalization.service';
import { ProcessingOutcomePolicy } from '../../../domain/policies/processing-outcome.policy';
import { buildUnavailableLlmResponse } from './llm-response.utils';

@Injectable()
export class OcrLlmExtractionPipelineAdapter implements ExtractionPipelinePort {
  public constructor(
    private readonly outcomePolicy: ProcessingOutcomePolicy,
    private readonly pageRenderer: PageRendererPort,
    private readonly ocrEngine: OcrEnginePort,
    private readonly llmExtraction: LlmExtractionPort,
    private readonly normalizationService: TextNormalizationService,
    private readonly heuristicEvaluationService: HeuristicEvaluationService,
    private readonly maskingService: SensitiveDataMaskingService,
    private readonly textConsolidationService: TextConsolidationService
  ) {}

  public async extract(input: Parameters<ExtractionPipelinePort['extract']>[0]): Promise<ProcessingOutcome> {
    const originalText = input.original.toString('utf8');

    if (originalText.includes('[[TRANSIENT_FAILURE]]')) {
      throw new TransientFailureError('Deterministic extraction pipeline transient failure');
    }
    if (originalText.includes('[[FATAL_FAILURE]]')) {
      throw new FatalFailureError('Simulated fatal failure');
    }

    const renderedPages = await this.renderDocumentPages(input.document.mimeType, input.original, input.document.pageCount);
    const pageExtractions = await this.extractPages(input.job.jobId, renderedPages);
    const fallbackTargets = this.heuristicEvaluationService.evaluateFallbackTargets({
      pages: pageExtractions,
      renderedPages
    });

    const fallbackArtifacts = await this.executeFallbackTargets(input.job.jobId, fallbackTargets);
    this.mergeFallbackResponsesIntoPageText(pageExtractions, fallbackTargets);

    const consolidatedText = this.buildConsolidatedDocumentText(pageExtractions, fallbackTargets);
    if (!this.hasUsablePayload(consolidatedText)) {
      throw new FatalFailureError('No usable payload after OCR and allowed fallbacks', {
        jobId: input.job.jobId,
        attemptId: input.attempt.attemptId
      });
    }

    const { confidence, warnings } = this.heuristicEvaluationService.calculateConfidenceAndWarnings({
      pages: pageExtractions,
      targets: fallbackTargets,
      payload: consolidatedText
    });
    const status = this.outcomePolicy.decide({
      payload: consolidatedText,
      warnings
    });
    const artifacts = [
      ...pageExtractions.map((page) => page.renderReference),
      ...pageExtractions.map((page) => page.rawOcrReference),
      ...fallbackArtifacts
    ];

    return {
      status,
      engineUsed: fallbackTargets.length === 0 ? 'OCR' : 'OCR+LLM',
      confidence,
      warnings,
      payload: consolidatedText,
      artifacts,
      fallbackUsed: fallbackTargets.length > 0,
      fallbackReason: fallbackTargets[0]?.fallbackReason,
      promptVersion: fallbackTargets.length > 0 ? DEFAULT_PROMPT_VERSION : undefined,
      modelVersion: fallbackTargets.length > 0 ? this.llmExtraction.getModelVersion() : undefined,
      normalizationVersion: DEFAULT_NORMALIZATION_VERSION,
      totalLatencyMs: this.calculateLatencyMs(renderedPages.length, fallbackTargets.length, artifacts.length)
    };
  }

  private async renderDocumentPages(mimeType: string, original: Buffer, pageCount: number): Promise<RenderedPage[]> {
    return this.pageRenderer.render({ mimeType, original, pageCount });
  }

  private async extractPages(jobId: string, renderedPages: RenderedPage[]): Promise<PageExtraction[]> {
    const pageExtractions: PageExtraction[] = [];

    for (const page of renderedPages) {
      const rawOcr = await this.ocrEngine.extract({ page });
      const normalizedText = this.normalizationService.normalizeOcrTextByPage(rawOcr.rawText);

      pageExtractions.push({
        pageNumber: page.pageNumber,
        renderReference: this.buildRenderArtifact(jobId, page),
        rawOcrReference: this.buildRawOcrArtifact(jobId, page.pageNumber, rawOcr),
        rawOcrText: rawOcr.rawText,
        normalizedText,
        handwrittenSegments: this.heuristicEvaluationService.detectHandwrittenSegments({
          pageNumber: page.pageNumber,
          normalizedText
        }),
        checkboxFindings: this.heuristicEvaluationService.detectCheckboxFindings({
          pageNumber: page.pageNumber,
          normalizedText
        }),
        criticalFieldFindings: this.heuristicEvaluationService.detectCriticalFieldFindings({
          pageNumber: page.pageNumber,
          normalizedText
        }),
        confidenceScore: rawOcr.confidenceScore
      });
    }

    return pageExtractions;
  }

  private async executeFallbackTargets(jobId: string, targets: FallbackTarget[]): Promise<ArtifactReference[]> {
    if (targets.length === 0) {
      return [];
    }

    const requests: LlmFallbackRequest[] = targets.map((target) => {
      const maskedTarget = this.maskingService.maskForExternalLlm(target.sourceText);
      const maskedText = maskedTarget.maskedText;
      const promptText = this.buildMaskedPromptForTarget(target, maskedText);
      const maskedPromptReference = this.buildMaskedTextArtifact(jobId, target, maskedText);
      target.maskedText = maskedText;
      target.promptText = promptText;
      target.placeholderMap = maskedTarget.placeholderMap;
      target.maskedPromptReference = maskedPromptReference;
      target.llmResponseReference = this.buildResponseArtifact(jobId, target, '[pending]');

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
      responses = requests.map((request) => buildUnavailableLlmResponse(request, this.llmExtraction.getModelVersion()));
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
      target.llmResponseReference = this.buildResponseArtifact(jobId, target, response.responseText, response.resolvedText);
    }

    return targets.flatMap((target) => {
      const references: ArtifactReference[] = [];
      if (target.maskedPromptReference !== undefined) {
        references.push(target.maskedPromptReference);
      }
      references.push(this.buildPromptArtifact(jobId, target, target.promptText ?? ''));
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

  private buildConsolidatedDocumentText(pageExtractions: PageExtraction[], targets: FallbackTarget[]): string {
    const documentTarget = targets.find((target) => target.targetType === 'DOCUMENT');
    if (documentTarget?.resolvedText !== undefined) {
      return this.normalizationService.normalizeOcrTextByPage(documentTarget.resolvedText);
    }

    return this.textConsolidationService.buildConsolidatedDocumentText(pageExtractions);
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

  private buildRenderArtifact(jobId: string, page: RenderedPage): ArtifactReference {
    return {
      artifactId: `artifact-render-${jobId}-page-${page.pageNumber}`,
      artifactType: ArtifactType.RENDERED_IMAGE,
      storageBucket: 'artifacts',
      storageObjectKey: `render/${jobId}/page-${page.pageNumber}.png`,
      mimeType: page.mimeType,
      pageNumber: page.pageNumber,
      metadata: {
        renderedFrom: 'default-page-renderer',
        pageSourceLength: page.sourceText.length
      }
    };
  }

  private buildRawOcrArtifact(jobId: string, pageNumber: number, rawOcr: { rawText: string; rawPayload: Record<string, unknown> }): ArtifactReference {
    return {
      artifactId: `artifact-ocr-${jobId}-page-${pageNumber}`,
      artifactType: ArtifactType.OCR_JSON,
      storageBucket: 'artifacts',
      storageObjectKey: `ocr/${jobId}/page-${pageNumber}.json`,
      mimeType: 'application/json',
      pageNumber,
      metadata: {
        rawText: rawOcr.rawText,
        rawPayload: rawOcr.rawPayload
      }
    };
  }

  private buildMaskedTextArtifact(jobId: string, target: FallbackTarget, maskedText: string): ArtifactReference {
    return {
      artifactId: `artifact-masked-${jobId}-${target.targetId}`,
      artifactType: ArtifactType.MASKED_TEXT,
      storageBucket: 'artifacts',
      storageObjectKey: `masked/${jobId}/${target.targetId}.txt`,
      mimeType: 'text/plain',
      pageNumber: target.pageNumber,
      metadata: {
        targetId: target.targetId,
        maskedText,
        fallbackReason: target.fallbackReason
      }
    };
  }

  private buildPromptArtifact(jobId: string, target: FallbackTarget, promptText: string): ArtifactReference {
    return {
      artifactId: `artifact-prompt-${jobId}-${target.targetId}`,
      artifactType: ArtifactType.LLM_PROMPT,
      storageBucket: 'artifacts',
      storageObjectKey: `prompts/${jobId}/${target.targetId}.txt`,
      mimeType: 'text/plain',
      pageNumber: target.pageNumber,
      metadata: {
        targetId: target.targetId,
        promptText
      }
    };
  }

  private buildResponseArtifact(
    jobId: string,
    target: FallbackTarget,
    responseText: string,
    resolvedText?: string
  ): ArtifactReference {
    return {
      artifactId: `artifact-response-${jobId}-${target.targetId}`,
      artifactType: ArtifactType.LLM_RESPONSE,
      storageBucket: 'artifacts',
      storageObjectKey: `responses/${jobId}/${target.targetId}.txt`,
      mimeType: 'text/plain',
      pageNumber: target.pageNumber,
      metadata: {
        targetId: target.targetId,
        responseText,
        resolvedText
      }
    };
  }
}
