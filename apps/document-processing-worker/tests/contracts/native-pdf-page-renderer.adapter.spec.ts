import { NativePdfPageRendererAdapter } from '../../src/adapters/out/extraction/native-pdf-page-renderer.adapter';

describe('NativePdfPageRendererAdapter contract', () => {
  it('returns one rendered page per PDF page with image bytes', async () => {
    const pdfTools = {
      renderPages: jest.fn().mockResolvedValue([
        { pageNumber: 1, mimeType: 'image/png', imageBytes: Buffer.from('page-1'), sourceText: '' },
        { pageNumber: 2, mimeType: 'image/png', imageBytes: Buffer.from('page-2'), sourceText: '' }
      ])
    };
    const adapter = new NativePdfPageRendererAdapter(pdfTools as never);

    await expect(
      adapter.render({
        mimeType: 'application/pdf',
        original: Buffer.from('%PDF-1.7 binary fixture'),
        pageCount: 2
      })
    ).resolves.toHaveLength(2);
  });
});
