import type { FallbackReason, JobWarning } from '@document-parser/shared-kernel';
import type { OcrPageResult, RenderedPage, TargetLocator, ExtractionTargetType } from './extraction.types';

export interface PageRendererPort {
  render(input: { mimeType: string; original: Buffer; pageCount: number }): Promise<RenderedPage[]>;
}

export interface OcrEnginePort {
  extract(input: { page: RenderedPage }): Promise<OcrPageResult>;
}

export type LlmFallbackRequest = {
  targetId: string;
  pageNumber?: number;
  targetType: ExtractionTargetType;
  fallbackReason: FallbackReason;
  targetLocator: TargetLocator;
  maskedText: string;
  promptText: string;
};

export type LlmFallbackResponse = {
  targetId: string;
  responseText: string;
  resolvedText?: string;
  confidenceScore: number;
  modelVersion?: string;
  warning?: JobWarning;
};

export interface LlmExtractionPort {
  extractTargets(input: { requests: LlmFallbackRequest[] }): Promise<LlmFallbackResponse[]>;
  getModelVersion(): string | undefined;
}
