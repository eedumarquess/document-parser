import { Injectable } from '@nestjs/common';
import { TransientFailureError } from '@document-parser/shared-kernel';
import type {
  LlmExtractionPort,
  LlmFallbackRequest,
  LlmFallbackResponse
} from '../../../domain/extraction/extraction-ports';
import { normalizeRecoveredText } from './llm-response.utils';

type FetchLike = typeof fetch;

export type HuggingFaceLlmConfig = {
  apiKey?: string;
  model: string;
  baseUrl?: string;
};

@Injectable()
export class HuggingFaceLlmExtractionAdapter implements LlmExtractionPort {
  public constructor(
    private readonly config: HuggingFaceLlmConfig,
    private readonly fetchFn: FetchLike,
    private readonly fallbackAdapter: LlmExtractionPort
  ) {}

  public async extractTargets(input: { requests: LlmFallbackRequest[] }): Promise<LlmFallbackResponse[]> {
    if (this.config.apiKey === undefined) {
      return this.fallbackAdapter.extractTargets(input);
    }

    const responses: LlmFallbackResponse[] = [];
    for (const request of input.requests) {
      responses.push(await this.callRemoteProvider(request));
    }

    return responses;
  }

  public getModelVersion(): string {
    if (this.config.apiKey === undefined) {
      return this.fallbackAdapter.getModelVersion() ?? `huggingface:${this.config.model}`;
    }

    return `huggingface:${this.config.model}`;
  }

  private async callRemoteProvider(request: LlmFallbackRequest): Promise<LlmFallbackResponse> {
    let response: Response;

    try {
      response = await this.fetchFn(this.config.baseUrl ?? 'https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: 'system',
              content: 'Recover the best possible text for the target. Return only the recovered text or [ilegivel].'
            },
            {
              role: 'user',
              content: request.promptText
            }
          ],
          temperature: 0
        })
      });
    } catch (error) {
      throw new TransientFailureError('HuggingFace LLM fallback failed', {
        cause: error instanceof Error ? error.message : 'unknown_error'
      });
    }

    if (!response.ok) {
      throw new TransientFailureError('HuggingFace LLM fallback failed', {
        statusCode: response.status
      });
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const responseText = payload.choices?.[0]?.message?.content?.trim() ?? '[ilegivel]';
    const resolvedText = normalizeRecoveredText(responseText);

    return {
      targetId: request.targetId,
      responseText,
      resolvedText,
      confidenceScore: resolvedText === undefined ? 0.18 : 0.77,
      modelVersion: this.getModelVersion()
    };
  }
}
