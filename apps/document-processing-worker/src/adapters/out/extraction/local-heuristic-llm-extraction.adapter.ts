import { Injectable } from '@nestjs/common';
import type {
  LlmExtractionPort,
  LlmFallbackRequest,
  LlmFallbackResponse
} from '../../../domain/extraction/extraction-ports';
import { buildUnavailableLlmResponse, normalizeRecoveredText } from './llm-response.utils';

@Injectable()
export class LocalHeuristicLlmExtractionAdapter implements LlmExtractionPort {
  private readonly modelVersion = 'local-heuristic-v1';

  public async extractTargets(input: { requests: LlmFallbackRequest[] }): Promise<LlmFallbackResponse[]> {
    return input.requests.map((request) => this.resolveRequest(request));
  }

  public getModelVersion(): string {
    return this.modelVersion;
  }

  private resolveRequest(request: LlmFallbackRequest): LlmFallbackResponse {
    if (request.promptText.includes('[[LLM_UNAVAILABLE]]') || request.maskedText.includes('[[LLM_UNAVAILABLE]]')) {
      return buildUnavailableLlmResponse(request, this.modelVersion);
    }

    if (request.targetType === 'CHECKBOX') {
      const match = request.maskedText.match(/checkbox:([^:]+):(checked|unchecked)/i);
      if (match !== null) {
        const resolvedText = `${match[1].trim()}: ${match[2] === 'checked' ? '[marcado]' : '[desmarcado]'}`;
        return {
          targetId: request.targetId,
          responseText: resolvedText,
          resolvedText,
          confidenceScore: 0.86,
          modelVersion: this.modelVersion
        };
      }
    }

    if (request.targetType === 'FIELD') {
      const separatorIndex = request.maskedText.indexOf(':');
      const resolvedText = normalizeRecoveredText(
        separatorIndex === -1 ? request.maskedText : request.maskedText.slice(separatorIndex + 1)
      );
      return {
        targetId: request.targetId,
        responseText: resolvedText ?? '[ilegivel]',
        resolvedText,
        confidenceScore: resolvedText === undefined ? 0.18 : 0.79,
        modelVersion: this.modelVersion
      };
    }

    const resolvedText = normalizeRecoveredText(
      request.maskedText
        .replaceAll(/\[\[(?:OCR_EMPTY|LOW_CONFIDENCE)\]\]/g, ' ')
        .replaceAll(/checkbox:([^:]+):checked/gi, '$1: [marcado]')
        .replaceAll(/checkbox:([^:]+):unchecked/gi, '$1: [desmarcado]')
        .replaceAll(/[ \t]+/g, ' ')
    );

    return {
      targetId: request.targetId,
      responseText: resolvedText ?? '[ilegivel]',
      resolvedText,
      confidenceScore: resolvedText === undefined ? 0.2 : 0.74,
      modelVersion: this.modelVersion
    };
  }
}
