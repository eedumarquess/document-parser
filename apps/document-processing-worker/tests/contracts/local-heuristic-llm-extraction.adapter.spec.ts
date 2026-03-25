import { ExtractionWarning, FallbackReason } from '@document-parser/shared-kernel';
import { LocalHeuristicLlmExtractionAdapter } from '../../src/adapters/out/extraction/local-heuristic-llm-extraction.adapter';

describe('LocalHeuristicLlmExtractionAdapter contract', () => {
  const adapter = new LocalHeuristicLlmExtractionAdapter();

  it('recovers checkbox states from masked fallback text', async () => {
    const [response] = await adapter.extractTargets({
      requests: [
        {
          targetId: 'checkbox-1',
          pageNumber: 1,
          targetType: 'CHECKBOX',
          fallbackReason: FallbackReason.CHECKBOX_AMBIGUOUS,
          targetLocator: { locatorType: 'CHECKBOX', pageNumber: 1, label: 'febre' },
          maskedText: 'checkbox:febre:checked',
          promptText: 'recover'
        }
      ]
    });

    expect(response.resolvedText).toBe('febre: [marcado]');
    expect(response.warning).toBeUndefined();
  });

  it('reports provider unavailability without fabricating text', async () => {
    const [response] = await adapter.extractTargets({
      requests: [
        {
          targetId: 'page-1',
          pageNumber: 1,
          targetType: 'PAGE',
          fallbackReason: FallbackReason.OCR_EMPTY,
          targetLocator: { locatorType: 'PAGE', pageNumber: 1 },
          maskedText: '[[LLM_UNAVAILABLE]]',
          promptText: '[[LLM_UNAVAILABLE]]'
        }
      ]
    });

    expect(response.resolvedText).toBeUndefined();
    expect(response.warning).toBe(ExtractionWarning.LLM_FALLBACK_UNAVAILABLE);
  });
});
