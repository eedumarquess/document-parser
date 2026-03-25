import { ExtractionWarning, FallbackReason } from '@document-parser/shared-kernel';
import type { JobWarning } from '@document-parser/shared-kernel';
import type { FallbackTarget, PageExtraction, RenderedPage } from './extraction.types';
import type { TextNormalizationService } from './text-normalization.service';

const PAGE_CONFIDENCE_FALLBACK_THRESHOLD = 0.45;

export class HeuristicEvaluationService {
  public constructor(private readonly normalizationService: TextNormalizationService) {}

  public detectHandwrittenSegments(input: {
    pageNumber: number;
    normalizedText: string;
  }): PageExtraction['handwrittenSegments'] {
    const segments: PageExtraction['handwrittenSegments'] = [];
    let index = 0;

    for (const match of input.normalizedText.matchAll(/\[\[HANDWRITING:([^\]]+)\]\]/g)) {
      index += 1;
      segments.push({
        segmentKey: `handwriting-${input.pageNumber}-${index}`,
        originalMarker: match[0],
        sourceText: match[1].trim(),
        classification: 'LOW_CONFIDENCE',
        locator: {
          locatorType: 'TEXT_SEGMENT',
          pageNumber: input.pageNumber,
          segmentKey: `handwriting-${input.pageNumber}-${index}`
        },
        confidenceScore: 0.35
      });
    }

    return segments;
  }

  public detectCheckboxFindings(input: {
    pageNumber: number;
    normalizedText: string;
  }): PageExtraction['checkboxFindings'] {
    // These findings stay internal to a single attempt and only drive fallback behavior.
    // They are not administrative template definitions.
    const findings: PageExtraction['checkboxFindings'] = [];
    let index = 0;

    for (const match of input.normalizedText.matchAll(/\[\[AMBIGUOUS_CHECKBOX:([^:\]]+):(checked|unchecked)\]\]/g)) {
      index += 1;
      findings.push({
        segmentKey: `checkbox-${input.pageNumber}-${index}`,
        originalMarker: match[0],
        label: match[1].trim(),
        state: 'AMBIGUOUS',
        expectedState: match[2] === 'checked' ? 'CHECKED' : 'UNCHECKED',
        locator: {
          locatorType: 'CHECKBOX',
          pageNumber: input.pageNumber,
          segmentKey: `checkbox-${input.pageNumber}-${index}`,
          label: match[1].trim()
        },
        confidenceScore: 0.32
      });
    }

    return findings;
  }

  public detectCriticalFieldFindings(input: {
    pageNumber: number;
    normalizedText: string;
  }): PageExtraction['criticalFieldFindings'] {
    // Critical field markers are heuristic extraction hints, not a canonical field catalog.
    const findings: PageExtraction['criticalFieldFindings'] = [];
    let index = 0;

    for (const match of input.normalizedText.matchAll(/\[\[CRITICAL_MISSING:([^:\]]+):([^\]]+)\]\]/g)) {
      index += 1;
      findings.push({
        segmentKey: `field-${input.pageNumber}-${index}`,
        originalMarker: match[0],
        fieldName: match[1].trim(),
        sourceText: match[2].trim(),
        locator: {
          locatorType: 'FIELD',
          pageNumber: input.pageNumber,
          segmentKey: `field-${input.pageNumber}-${index}`,
          label: match[1].trim()
        },
        confidenceScore: 0.28
      });
    }

    return findings;
  }

  public evaluateFallbackTargets(input: {
    pages: PageExtraction[];
    renderedPages: RenderedPage[];
  }): FallbackTarget[] {
    const targets: FallbackTarget[] = [];
    const everyPageNeedsGlobalFallback =
      input.pages.length > 0 &&
      input.pages.every((page) => page.rawOcrText.trim() === '' || page.confidenceScore < PAGE_CONFIDENCE_FALLBACK_THRESHOLD);

    if (everyPageNeedsGlobalFallback) {
      const fallbackReason =
        input.pages.every((page) => page.rawOcrText.trim() === '') ? FallbackReason.OCR_EMPTY : FallbackReason.LOW_GLOBAL_CONFIDENCE;

      targets.push({
        targetId: 'document-fallback',
        targetType: 'DOCUMENT',
        targetLocator: { locatorType: 'DOCUMENT' },
        sourceText: input.renderedPages
          .map((page) => this.normalizationService.buildReadableSourceText(page.sourceText))
          .join('\n\n')
          .trim(),
        fallbackReason,
        isCritical: true,
        confidenceScore: 0.2
      });

      return targets;
    }

    for (const page of input.pages) {
      const renderedPage = input.renderedPages.find((candidate) => candidate.pageNumber === page.pageNumber);
      if (renderedPage !== undefined && page.rawOcrText.trim() === '') {
        targets.push({
          targetId: `page-${page.pageNumber}-ocr-empty`,
          pageNumber: page.pageNumber,
          targetType: 'PAGE',
          targetLocator: { locatorType: 'PAGE', pageNumber: page.pageNumber },
          sourceText: this.normalizationService.buildReadableSourceText(renderedPage.sourceText),
          fallbackReason: FallbackReason.OCR_EMPTY,
          isCritical: true,
          confidenceScore: 0.2
        });
      } else if (renderedPage !== undefined && page.confidenceScore < PAGE_CONFIDENCE_FALLBACK_THRESHOLD) {
        targets.push({
          targetId: `page-${page.pageNumber}-low-confidence`,
          pageNumber: page.pageNumber,
          targetType: 'PAGE',
          targetLocator: { locatorType: 'PAGE', pageNumber: page.pageNumber },
          sourceText: this.normalizationService.buildReadableSourceText(renderedPage.sourceText),
          fallbackReason: FallbackReason.LOW_GLOBAL_CONFIDENCE,
          isCritical: true,
          confidenceScore: 0.25
        });
      }

      for (const segment of page.handwrittenSegments) {
        targets.push({
          targetId: segment.segmentKey,
          pageNumber: page.pageNumber,
          targetType: 'HANDWRITING',
          targetLocator: segment.locator,
          sourceText: segment.sourceText,
          fallbackReason: FallbackReason.HANDWRITING_DETECTED,
          isCritical: false,
          originalMarker: segment.originalMarker,
          confidenceScore: segment.confidenceScore
        });
      }

      for (const checkbox of page.checkboxFindings) {
        targets.push({
          targetId: checkbox.segmentKey,
          pageNumber: page.pageNumber,
          targetType: 'CHECKBOX',
          targetLocator: checkbox.locator,
          sourceText: `checkbox:${checkbox.label}:${checkbox.expectedState === 'CHECKED' ? 'checked' : 'unchecked'}`,
          fallbackReason: FallbackReason.CHECKBOX_AMBIGUOUS,
          isCritical: false,
          originalMarker: checkbox.originalMarker,
          confidenceScore: checkbox.confidenceScore
        });
      }

      for (const field of page.criticalFieldFindings) {
        targets.push({
          targetId: field.segmentKey,
          pageNumber: page.pageNumber,
          targetType: 'FIELD',
          targetLocator: field.locator,
          sourceText: `${field.fieldName}:${field.sourceText}`,
          fallbackReason: FallbackReason.CRITICAL_TARGET_MISSING,
          isCritical: true,
          originalMarker: field.originalMarker,
          confidenceScore: field.confidenceScore
        });
      }
    }

    return targets;
  }

  public calculateConfidenceAndWarnings(input: {
    pages: PageExtraction[];
    targets: FallbackTarget[];
    payload: string;
  }): { confidence: number; warnings: JobWarning[] } {
    const warnings = new Set<JobWarning>();
    const resolvedDocumentFallback = input.targets.some(
      (target) => target.targetType === 'DOCUMENT' && target.resolvedText !== undefined
    );
    const resolvedPageFallbacks = new Set(
      input.targets
        .filter((target) => target.targetType === 'PAGE' && target.resolvedText !== undefined)
        .map((target) => target.pageNumber)
    );
    const relevantTargets = input.targets.filter((target) => {
      if (resolvedDocumentFallback && target.targetType !== 'DOCUMENT') {
        return false;
      }
      if (target.pageNumber !== undefined && resolvedPageFallbacks.has(target.pageNumber) && target.targetType !== 'PAGE') {
        return false;
      }
      return true;
    });
    const unresolvedTargets = relevantTargets.filter((target) => target.resolvedText === undefined);
    const resolvedTargets = relevantTargets.filter((target) => target.resolvedText !== undefined);

    if (input.payload.includes('[ilegivel]')) {
      warnings.add(ExtractionWarning.ILLEGIBLE_CONTENT);
    }

    if (unresolvedTargets.some((target) => target.targetType === 'HANDWRITING')) {
      warnings.add(ExtractionWarning.HANDWRITING_LOW_CONFIDENCE);
    }

    if (unresolvedTargets.some((target) => target.targetType === 'CHECKBOX')) {
      warnings.add(ExtractionWarning.AMBIGUOUS_CHECKBOX);
    }

    if (relevantTargets.some((target) => target.warning === ExtractionWarning.LLM_FALLBACK_UNAVAILABLE)) {
      warnings.add(ExtractionWarning.LLM_FALLBACK_UNAVAILABLE);
    }

    if (resolvedTargets.length > 0 && unresolvedTargets.length > 0) {
      warnings.add(ExtractionWarning.PARTIAL_TARGET_RECOVERY);
    }

    let confidence = 0.97;

    for (const page of input.pages) {
      confidence -= (1 - page.confidenceScore) * 0.18;
    }

    confidence -= warnings.size * 0.05;

    if (unresolvedTargets.some((target) => target.isCritical)) {
      confidence -= 0.08;
    }

    return {
      confidence: Math.max(0.1, Number(confidence.toFixed(2))),
      warnings: [...warnings]
    };
  }
}
