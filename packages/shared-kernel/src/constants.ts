export const DEFAULT_REQUESTED_MODE = 'STANDARD';
export const DEFAULT_PRIORITY = 'NORMAL';
export const DEFAULT_PROCESSING_QUEUE_NAME = 'document-processing.requested';
export const DEFAULT_OUTPUT_VERSION = '1.0.0';
export const DEFAULT_PIPELINE_VERSION = 'dev-sha';
export const DEFAULT_NORMALIZATION_VERSION = 'dev-sha';
export const DEFAULT_PROMPT_VERSION = 'dev-sha';
export const DEFAULT_MODEL_VERSION = 'dev-sha';
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 10;
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [2000, 4000, 8000] as const;

export const ExtractionWarning = {
  ILLEGIBLE_CONTENT: 'ILLEGIBLE_CONTENT',
  HANDWRITING_LOW_CONFIDENCE: 'HANDWRITING_LOW_CONFIDENCE',
  AMBIGUOUS_CHECKBOX: 'AMBIGUOUS_CHECKBOX',
  LLM_FALLBACK_UNAVAILABLE: 'LLM_FALLBACK_UNAVAILABLE',
  PARTIAL_TARGET_RECOVERY: 'PARTIAL_TARGET_RECOVERY'
} as const;
export type ExtractionWarning = (typeof ExtractionWarning)[keyof typeof ExtractionWarning];

export const FallbackReason = {
  OCR_EMPTY: 'OCR_EMPTY',
  LOW_GLOBAL_CONFIDENCE: 'LOW_GLOBAL_CONFIDENCE',
  HANDWRITING_DETECTED: 'HANDWRITING_DETECTED',
  CHECKBOX_AMBIGUOUS: 'CHECKBOX_AMBIGUOUS',
  CRITICAL_TARGET_MISSING: 'CRITICAL_TARGET_MISSING'
} as const;
export type FallbackReason = (typeof FallbackReason)[keyof typeof FallbackReason];
