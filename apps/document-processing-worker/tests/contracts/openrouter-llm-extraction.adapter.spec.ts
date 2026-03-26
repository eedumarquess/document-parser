import {
  ExtractionWarning,
  FallbackReason
} from '@document-parser/shared-kernel';
import { LocalHeuristicLlmExtractionAdapter } from '../../src/adapters/out/extraction/local-heuristic-llm-extraction.adapter';
import { OpenRouterLlmExtractionAdapter } from '../../src/adapters/out/extraction/openrouter-llm-extraction.adapter';

const buildRequest = (targetId: string) => ({
  targetId,
  pageNumber: 1,
  targetType: 'PAGE' as const,
  fallbackReason: FallbackReason.OCR_EMPTY,
  targetLocator: { locatorType: 'PAGE' as const, pageNumber: 1 },
  maskedText: `texto:${targetId}`,
  promptText: `Recover the best possible text for ${targetId}`
});

describe('OpenRouterLlmExtractionAdapter contract', () => {
  it('maps chat completions into deterministic target responses', async () => {
    const fetchMock: typeof fetch = jest.fn(async (_url, init) => {
      const requestBody = typeof init?.body === 'string' ? init.body : '';
      expect(requestBody).toContain('Recover the best possible text');

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
      requests: [buildRequest('page-1')]
    });

    expect(response.resolvedText).toBe('texto recuperado');
    expect(response.modelVersion).toBe('openrouter:openai/gpt-4o-mini');
  });

  it('limits concurrent remote requests and preserves response order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock: typeof fetch = jest.fn(async (_url, init) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const rawBody = typeof init?.body === 'string' ? init.body : '{}';
      const requestBody = JSON.parse(rawBody) as {
        messages: Array<{ content: string }>;
      };
      const requestId = requestBody.messages[1]?.content.split(' ').at(-1) ?? 'unknown';

      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: `resolved:${requestId}` } }]
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
        model: 'openai/gpt-4o-mini',
        execution: {
          maxConcurrency: 2,
          maxRetries: 0
        }
      },
      fetchMock,
      new LocalHeuristicLlmExtractionAdapter()
    );

    const responses = await adapter.extractTargets({
      requests: [buildRequest('target-1'), buildRequest('target-2'), buildRequest('target-3')]
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(responses.map((response) => response.targetId)).toEqual(['target-1', 'target-2', 'target-3']);
    expect(responses.map((response) => response.resolvedText)).toEqual([
      'resolved:target-1',
      'resolved:target-2',
      'resolved:target-3'
    ]);
  });

  it('retries transient provider failures before succeeding', async () => {
    let callCount = 0;
    const fetchMock: typeof fetch = jest.fn(async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response('rate limited', { status: 429 });
      }

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'texto apos retry' } }]
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
        model: 'openai/gpt-4o-mini',
        execution: {
          maxRetries: 2,
          retryBaseDelayMs: 1
        }
      },
      fetchMock,
      new LocalHeuristicLlmExtractionAdapter()
    );

    const [response] = await adapter.extractTargets({
      requests: [buildRequest('retry-target')]
    });

    expect(callCount).toBe(2);
    expect(response.resolvedText).toBe('texto apos retry');
  });

  it('returns an unavailable response when the remote request times out', async () => {
    const fetchMock: typeof fetch = jest.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        })
    ) as typeof fetch;

    const adapter = new OpenRouterLlmExtractionAdapter(
      {
        apiKey: 'token',
        model: 'openai/gpt-4o-mini',
        execution: {
          requestTimeoutMs: 5,
          maxRetries: 0
        }
      },
      fetchMock,
      new LocalHeuristicLlmExtractionAdapter()
    );

    const [response] = await adapter.extractTargets({
      requests: [buildRequest('timeout-target')]
    });

    expect(response).toMatchObject({
      targetId: 'timeout-target',
      warning: ExtractionWarning.LLM_FALLBACK_UNAVAILABLE,
      resolvedText: undefined
    });
  });

  it('returns an unavailable response without retrying non-retryable provider errors', async () => {
    const fetchMock: typeof fetch = jest.fn(async () => new Response('unauthorized', { status: 401 })) as typeof fetch;

    const adapter = new OpenRouterLlmExtractionAdapter(
      {
        apiKey: 'token',
        model: 'openai/gpt-4o-mini',
        execution: {
          maxRetries: 2,
          retryBaseDelayMs: 1
        }
      },
      fetchMock,
      new LocalHeuristicLlmExtractionAdapter()
    );

    const [response] = await adapter.extractTargets({
      requests: [buildRequest('fatal-target')]
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      targetId: 'fatal-target',
      warning: ExtractionWarning.LLM_FALLBACK_UNAVAILABLE
    });
  });
});
