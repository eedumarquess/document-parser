import type { OcrEnginePort } from '../../../domain/extraction/extraction-ports';
import type { OcrPageResult, RenderedPage } from '../../../domain/extraction/extraction.types';

export class CompositeOcrEngineAdapter implements OcrEnginePort {
  public constructor(
    private readonly nativePdfOcr: OcrEnginePort,
    private readonly fallbackOcr: OcrEnginePort
  ) {}

  public async extract(input: { page: RenderedPage }): Promise<OcrPageResult> {
    return input.page.imageBytes !== undefined
      ? this.nativePdfOcr.extract(input)
      : this.fallbackOcr.extract(input);
  }
}
