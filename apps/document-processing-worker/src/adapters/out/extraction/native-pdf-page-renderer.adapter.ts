import { Injectable } from '@nestjs/common';
import { PopplerPdfTools } from '@document-parser/shared-infrastructure';
import type { PageRendererPort } from '../../../domain/extraction/extraction-ports';
import type { RenderedPage } from '../../../domain/extraction/extraction.types';

@Injectable()
export class NativePdfPageRendererAdapter implements PageRendererPort {
  public constructor(private readonly pdfTools = new PopplerPdfTools()) {}

  public async render(input: {
    mimeType: string;
    original: Buffer;
    pageCount: number;
  }): Promise<RenderedPage[]> {
    return this.pdfTools.renderPages(input.original);
  }
}
