import { Injectable } from '@nestjs/common';
import type { PageRendererPort } from '../../../domain/extraction/extraction-ports';
import type { RenderedPage } from '../../../domain/extraction/extraction.types';

@Injectable()
export class DefaultPageRendererAdapter implements PageRendererPort {
  public async render(input: { mimeType: string; original: Buffer; pageCount: number }): Promise<RenderedPage[]> {
    const sourceText = input.original.toString('utf8');
    const chunks = sourceText.split(/\[\[PAGE_BREAK\]\]|\f/g);
    const pageTotal = Math.max(1, input.pageCount, chunks.length);
    const pages: RenderedPage[] = [];

    for (let index = 0; index < pageTotal; index += 1) {
      pages.push({
        pageNumber: index + 1,
        mimeType: 'image/png',
        sourceText: chunks[index]?.trim() ?? ''
      });
    }

    return pages;
  }
}
