import { DefaultPageRendererAdapter } from '../../src/adapters/out/extraction/default-page-renderer.adapter';

describe('DefaultPageRendererAdapter contract', () => {
  const adapter = new DefaultPageRendererAdapter();

  it('splits page content using the canonical page-break marker', async () => {
    const pages = await adapter.render({
      mimeType: 'application/pdf',
      original: Buffer.from('pagina 1[[PAGE_BREAK]]pagina 2'),
      pageCount: 2
    });

    expect(pages).toEqual([
      { pageNumber: 1, mimeType: 'image/png', sourceText: 'pagina 1' },
      { pageNumber: 2, mimeType: 'image/png', sourceText: 'pagina 2' }
    ]);
  });
});
