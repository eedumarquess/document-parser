import { Injectable } from '@nestjs/common';
import type { OcrEnginePort } from '../../../domain/extraction/extraction-ports';
import type { OcrPageResult } from '../../../domain/extraction/extraction.types';

@Injectable()
export class DeterministicOcrEngineAdapter implements OcrEnginePort {
  public async extract(input: { page: { pageNumber: number; sourceText: string } }): Promise<OcrPageResult> {
    const markerCount = (input.page.sourceText.match(/\[\[/g) ?? []).length;
    const rawText = input.page.sourceText.includes('[[OCR_EMPTY]]') ? '' : input.page.sourceText.trim();

    let confidenceScore = 0.94;
    if (rawText === '') {
      confidenceScore = 0.12;
    } else if (input.page.sourceText.includes('[[LOW_CONFIDENCE]]')) {
      confidenceScore = 0.34;
    } else if (
      input.page.sourceText.includes('[[HANDWRITING:') ||
      input.page.sourceText.includes('[[AMBIGUOUS_CHECKBOX:') ||
      input.page.sourceText.includes('[[CRITICAL_MISSING:')
    ) {
      confidenceScore = 0.58;
    }

    if (input.page.sourceText.includes('[[ILLEGIBLE]]')) {
      confidenceScore = Math.min(confidenceScore, 0.62);
    }

    return {
      pageNumber: input.page.pageNumber,
      rawText,
      confidenceScore,
      rawPayload: {
        provider: 'deterministic-ocr',
        markerCount,
        rawTextLength: rawText.length
      }
    };
  }
}
