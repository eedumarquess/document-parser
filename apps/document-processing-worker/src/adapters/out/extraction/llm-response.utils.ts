import { ExtractionWarning } from '@document-parser/shared-kernel';
import type { LlmFallbackRequest, LlmFallbackResponse } from '../../../domain/extraction/extraction-ports';

export function normalizeRecoveredText(text: string): string | undefined {
  const normalized = text
    .replaceAll(/\r\n/g, '\n')
    .replaceAll(/[ \t]+/g, ' ')
    .trim();

  if (normalized === '' || normalized === '[ilegivel]') {
    return undefined;
  }

  return normalized;
}

export function buildUnavailableLlmResponse(
  request: LlmFallbackRequest,
  modelVersion: string | undefined
): LlmFallbackResponse {
  return {
    targetId: request.targetId,
    responseText: '[llm_fallback_unavailable]',
    resolvedText: undefined,
    confidenceScore: 0.1,
    modelVersion,
    warning: ExtractionWarning.LLM_FALLBACK_UNAVAILABLE
  };
}
