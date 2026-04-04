import { Injectable } from '@nestjs/common';
import { TesseractOcrTools } from '@document-parser/shared-infrastructure';
import { FatalFailureError } from '@document-parser/shared-kernel';
import type { OcrEnginePort } from '../../../domain/extraction/extraction-ports';
import type { OcrPageResult, RenderedPage } from '../../../domain/extraction/extraction.types';

@Injectable()
export class TesseractOcrEngineAdapter implements OcrEnginePort {
  public constructor(private readonly ocrTools = new TesseractOcrTools()) {}

  public async extract(input: { page: RenderedPage }): Promise<OcrPageResult> {
    if (input.page.imageBytes === undefined) {
      throw new FatalFailureError('Missing image bytes for native PDF OCR', {
        pageNumber: input.page.pageNumber
      });
    }

    const result = await this.ocrTools.recognize(input.page.imageBytes);

    return {
      pageNumber: input.page.pageNumber,
      rawText: result.text,
      confidenceScore: result.confidenceScore,
      rawPayload: result.rawPayload
    };
  }
}
