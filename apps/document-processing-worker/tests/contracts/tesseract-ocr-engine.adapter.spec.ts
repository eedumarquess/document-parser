import { TesseractOcrEngineAdapter } from '../../src/adapters/out/extraction/tesseract-ocr-engine.adapter';

describe('TesseractOcrEngineAdapter contract', () => {
  it('extracts OCR from rendered image bytes', async () => {
    const ocrTools = {
      recognize: jest.fn().mockResolvedValue({
        text: 'Paciente consciente',
        confidenceScore: 0.91,
        rawPayload: { provider: 'tesseract', language: 'por' }
      })
    };
    const adapter = new TesseractOcrEngineAdapter(ocrTools as never);

    const result = await adapter.extract({
      page: {
        pageNumber: 1,
        mimeType: 'image/png',
        imageBytes: Buffer.from('png-binary'),
        sourceText: ''
      }
    });

    expect(result.rawText).toBe('Paciente consciente');
    expect(result.rawPayload).toMatchObject({ provider: 'tesseract' });
  });
});
