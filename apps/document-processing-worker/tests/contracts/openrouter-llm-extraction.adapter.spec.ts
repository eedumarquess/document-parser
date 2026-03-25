import { FallbackReason } from '@document-parser/shared-kernel';
import { LocalHeuristicLlmExtractionAdapter } from '../../src/adapters/out/extraction/local-heuristic-llm-extraction.adapter';
import { OpenRouterLlmExtractionAdapter } from '../../src/adapters/out/extraction/openrouter-llm-extraction.adapter';

describe('OpenRouterLlmExtractionAdapter contract', () => {
  it('maps chat completions into deterministic target responses', async () => {
    const fetchMock: typeof fetch = jest.fn(async (_url, init) => {
      expect(typeof init?.body).toBe('string');
      if (typeof init?.body !== 'string') {
        throw new Error('Expected serialized request body');
      }
      expect(init.body).toContain('Recover the best possible text');

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'texto recuperado' } }]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }) as typeof fetch;

    const adapter = new OpenRouterLlmExtractionAdapter(
      {
        apiKey: 'token',
        model: 'openai/gpt-4o-mini'
      },
      fetchMock,
      new LocalHeuristicLlmExtractionAdapter()
    );

    const [response] = await adapter.extractTargets({
      requests: [
        {
          targetId: 'page-1',
          pageNumber: 1,
          targetType: 'PAGE',
          fallbackReason: FallbackReason.OCR_EMPTY,
          targetLocator: { locatorType: 'PAGE', pageNumber: 1 },
          maskedText: 'texto recuperado',
          promptText: 'Recover the best possible text'
        }
      ]
    });

    expect(response.resolvedText).toBe('texto recuperado');
    expect(response.modelVersion).toBe('openrouter:openai/gpt-4o-mini');
  });
});
