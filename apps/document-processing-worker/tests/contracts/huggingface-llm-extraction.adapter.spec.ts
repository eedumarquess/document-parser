import {
  ExtractionWarning,
  FallbackReason
} from '@document-parser/shared-kernel';
import { HuggingFaceLlmExtractionAdapter } from '../../src/adapters/out/extraction/huggingface-llm-extraction.adapter';
import { LocalHeuristicLlmExtractionAdapter } from '../../src/adapters/out/extraction/local-heuristic-llm-extraction.adapter';

const request = {
  targetId: 'field-1',
  pageNumber: 1,
  targetType: 'FIELD' as const,
  fallbackReason: FallbackReason.CRITICAL_TARGET_MISSING,
  targetLocator: { locatorType: 'FIELD' as const, pageNumber: 1 },
  maskedText: 'cpf:[cpf_1]',
  promptText: 'Recover the best possible text'
};

describe('HuggingFaceLlmExtractionAdapter contract', () => {
  it('maps chat completions into deterministic target responses', async () => {
    const fetchMock: typeof fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'cpf:[cpf_1]' } }]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    ) as typeof fetch;

    const adapter = new HuggingFaceLlmExtractionAdapter(
      {
        apiKey: 'token',
        model: 'meta-llama/3.1-8b-instruct'
      },
      fetchMock,
      new LocalHeuristicLlmExtractionAdapter()
    );

    const [response] = await adapter.extractTargets({
      requests: [request]
    });

    expect(response).toMatchObject({
      targetId: 'field-1',
      resolvedText: 'cpf:[cpf_1]',
      modelVersion: 'huggingface:meta-llama/3.1-8b-instruct'
    });
  });

  it('returns an unavailable response when transient failures exhaust retries', async () => {
    const fetchMock: typeof fetch = jest.fn(async () => new Response('unavailable', { status: 503 })) as typeof fetch;

    const adapter = new HuggingFaceLlmExtractionAdapter(
      {
        apiKey: 'token',
        model: 'meta-llama/3.1-8b-instruct',
        execution: {
          maxRetries: 1,
          retryBaseDelayMs: 1
        }
      },
      fetchMock,
      new LocalHeuristicLlmExtractionAdapter()
    );

    const [response] = await adapter.extractTargets({
      requests: [request]
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.warning).toBe(ExtractionWarning.LLM_FALLBACK_UNAVAILABLE);
  });
});
