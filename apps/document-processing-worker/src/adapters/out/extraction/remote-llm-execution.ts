import {
  TimeoutFailureError,
  TransientFailureError
} from '@document-parser/shared-kernel';
import type {
  LlmFallbackRequest,
  LlmFallbackResponse
} from '../../../domain/extraction/extraction-ports';
import { buildUnavailableLlmResponse } from './llm-response.utils';

export type RemoteLlmExecutionConfig = {
  requestTimeoutMs: number;
  maxConcurrency: number;
  maxRetries: number;
  retryBaseDelayMs: number;
};

export const DEFAULT_REMOTE_LLM_EXECUTION_CONFIG: RemoteLlmExecutionConfig = {
  requestTimeoutMs: 8000,
  maxConcurrency: 3,
  maxRetries: 2,
  retryBaseDelayMs: 250
};

export function resolveRemoteLlmExecutionConfig(
  config: Partial<RemoteLlmExecutionConfig> = {}
): RemoteLlmExecutionConfig {
  return {
    requestTimeoutMs: normalizePositiveInteger(
      config.requestTimeoutMs,
      DEFAULT_REMOTE_LLM_EXECUTION_CONFIG.requestTimeoutMs
    ),
    maxConcurrency: normalizePositiveInteger(
      config.maxConcurrency,
      DEFAULT_REMOTE_LLM_EXECUTION_CONFIG.maxConcurrency
    ),
    maxRetries: normalizeNonNegativeInteger(
      config.maxRetries,
      DEFAULT_REMOTE_LLM_EXECUTION_CONFIG.maxRetries
    ),
    retryBaseDelayMs: normalizePositiveInteger(
      config.retryBaseDelayMs,
      DEFAULT_REMOTE_LLM_EXECUTION_CONFIG.retryBaseDelayMs
    )
  };
}

export function resolveRemoteLlmExecutionConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): RemoteLlmExecutionConfig {
  return resolveRemoteLlmExecutionConfig({
    requestTimeoutMs: parseIntegerEnv(env.LLM_REQUEST_TIMEOUT_MS),
    maxConcurrency: parseIntegerEnv(env.LLM_MAX_CONCURRENCY),
    maxRetries: parseIntegerEnv(env.LLM_MAX_RETRIES),
    retryBaseDelayMs: parseIntegerEnv(env.LLM_RETRY_BASE_DELAY_MS)
  });
}

export async function executeRemoteLlmRequests(input: {
  requests: LlmFallbackRequest[];
  config?: Partial<RemoteLlmExecutionConfig>;
  modelVersion: string | undefined;
  execute: (request: LlmFallbackRequest, signal: AbortSignal) => Promise<LlmFallbackResponse>;
}): Promise<LlmFallbackResponse[]> {
  const config = resolveRemoteLlmExecutionConfig(input.config);

  return mapWithConcurrencyLimit(input.requests, config.maxConcurrency, async (request) => {
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      try {
        return await executeWithTimeout({
          request,
          requestTimeoutMs: config.requestTimeoutMs,
          execute: input.execute
        });
      } catch (error) {
        if (!isRetryableRemoteError(error) || attempt >= config.maxRetries) {
          return buildUnavailableLlmResponse(request, input.modelVersion);
        }

        await wait(config.retryBaseDelayMs * 2 ** attempt);
      }
    }

    return buildUnavailableLlmResponse(request, input.modelVersion);
  });
}

async function executeWithTimeout(input: {
  request: LlmFallbackRequest;
  requestTimeoutMs: number;
  execute: (request: LlmFallbackRequest, signal: AbortSignal) => Promise<LlmFallbackResponse>;
}): Promise<LlmFallbackResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs);

  try {
    return await input.execute(input.request, controller.signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw new TimeoutFailureError('Remote LLM fallback timed out', {
        timeoutMs: input.requestTimeoutMs
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableRemoteError(error: unknown): boolean {
  return error instanceof TimeoutFailureError || error instanceof TransientFailureError;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

async function mapWithConcurrencyLimit<T, TResult>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function wait(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || value <= 0) {
    return fallback;
  }

  return Math.trunc(value);
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || value < 0) {
    return fallback;
  }

  return Math.trunc(value);
}
