import { Injectable } from '@nestjs/common';
import type { OcrEnginePort } from '../../../domain/extraction/extraction-ports';
import type { OcrPageResult } from '../../../domain/extraction/extraction.types';

@Injectable()
export class DeterministicOcrEngineAdapter implements OcrEnginePort {
  public async extract(input: {
    page: { pageNumber: number; sourceText: string; imageBytes?: Buffer };
  }): Promise<OcrPageResult> {
    const sourceText = input.page.sourceText ?? '';
    const markerCount = (sourceText.match(/\[\[/g) ?? []).length;
    const rawText = sourceText.includes('[[OCR_EMPTY]]') ? '' : sourceText.trim();

    let confidenceScore = 0.94;
    if (rawText === '') {
      confidenceScore = 0.12;
    } else if (sourceText.includes('[[LOW_CONFIDENCE]]')) {
      confidenceScore = 0.34;
    } else if (
      sourceText.includes('[[HANDWRITING:') ||
      sourceText.includes('[[AMBIGUOUS_CHECKBOX:') ||
      sourceText.includes('[[CRITICAL_MISSING:')
    ) {
      confidenceScore = 0.58;
    }

    if (sourceText.includes('[[ILLEGIBLE]]')) {
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
