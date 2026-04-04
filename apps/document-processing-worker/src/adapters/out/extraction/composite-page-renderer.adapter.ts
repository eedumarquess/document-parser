import type { PageRendererPort } from '../../../domain/extraction/extraction-ports';
import type { RenderedPage } from '../../../domain/extraction/extraction.types';

export class CompositePageRendererAdapter implements PageRendererPort {
  public constructor(
    private readonly pdfRenderer: PageRendererPort,
    private readonly fallbackRenderer: PageRendererPort
  ) {}

  public async render(input: {
    mimeType: string;
    original: Buffer;
    pageCount: number;
  }): Promise<RenderedPage[]> {
    return input.mimeType === 'application/pdf'
      ? this.pdfRenderer.render(input)
      : this.fallbackRenderer.render(input);
  }
}
