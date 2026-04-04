import { buildUploadedFile } from '@document-parser/testkit';
import { PdfInfoPageCounterAdapter } from '../../src/adapters/out/storage/pdfinfo-page-counter.adapter';

describe('PdfInfoPageCounterAdapter contract', () => {
  it('counts PDF pages from poppler metadata instead of UTF-8 regex', async () => {
    const pdfTools = {
      inspect: jest.fn().mockResolvedValue({ pageCount: 3 })
    };
    const adapter = new PdfInfoPageCounterAdapter(pdfTools as never);

    await expect(
      adapter.countPages(
        buildUploadedFile({
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7 binary fixture')
        })
      )
    ).resolves.toBe(3);

    expect(pdfTools.inspect).toHaveBeenCalledTimes(1);
  });

  it('does not invoke pdfinfo for non-PDF files and keeps the default page count', async () => {
    const pdfTools = {
      inspect: jest.fn().mockResolvedValue({ pageCount: 99 })
    };
    const adapter = new PdfInfoPageCounterAdapter(pdfTools as never);

    await expect(
      adapter.countPages(
        buildUploadedFile({
          mimeType: 'image/png',
          buffer: Buffer.from('not a real pdf')
        })
      )
    ).resolves.toBe(1);

    expect(pdfTools.inspect).not.toHaveBeenCalled();
  });
});
