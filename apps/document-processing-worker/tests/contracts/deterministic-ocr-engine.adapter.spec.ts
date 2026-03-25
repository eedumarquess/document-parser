import { DeterministicOcrEngineAdapter } from '../../src/adapters/out/extraction/deterministic-ocr-engine.adapter';

describe('DeterministicOcrEngineAdapter contract', () => {
  const adapter = new DeterministicOcrEngineAdapter();

  it('returns empty OCR text when the page is explicitly marked as OCR_EMPTY', async () => {
    const result = await adapter.extract({
      page: {
        pageNumber: 1,
        sourceText: '[[OCR_EMPTY]]'
      }
    });

    expect(result.rawText).toBe('');
    expect(result.confidenceScore).toBeLessThan(0.2);
  });

  it('drops confidence when the page carries low-confidence markers', async () => {
    const result = await adapter.extract({
      page: {
        pageNumber: 1,
        sourceText: 'texto [[LOW_CONFIDENCE]]'
      }
    });

    expect(result.rawText).toContain('texto');
    expect(result.confidenceScore).toBe(0.34);
  });
});
