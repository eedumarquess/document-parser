import type { ArtifactReference, FallbackReason, JobWarning } from '@document-parser/shared-kernel';

export type ConfidenceScore = number;

export type CheckboxState = 'CHECKED' | 'UNCHECKED' | 'AMBIGUOUS';

export type HandwritingClassification = 'NOT_DETECTED' | 'DETECTED' | 'LOW_CONFIDENCE' | 'RECOVERED';

export type ExtractionTargetType = 'DOCUMENT' | 'PAGE' | 'CHECKBOX' | 'HANDWRITING' | 'FIELD';

export type TargetLocator = {
  locatorType: 'DOCUMENT' | 'PAGE' | 'TEXT_SEGMENT' | 'CHECKBOX' | 'FIELD';
  pageNumber?: number;
  segmentKey?: string;
  label?: string;
};

export type RenderedPage = {
  pageNumber: number;
  mimeType: string;
  sourceText: string;
  imageBytes?: Buffer;
};

export type OcrPageResult = {
  pageNumber: number;
  rawText: string;
  confidenceScore: ConfidenceScore;
  rawPayload: Record<string, unknown>;
};

export type HandwrittenSegment = {
  segmentKey: string;
  originalMarker: string;
  sourceText: string;
  classification: HandwritingClassification;
  locator: TargetLocator;
  resolvedText?: string;
  confidenceScore: ConfidenceScore;
};

export type CheckboxFinding = {
  segmentKey: string;
  originalMarker: string;
  label: string;
  state: CheckboxState;
  expectedState?: Exclude<CheckboxState, 'AMBIGUOUS'>;
  locator: TargetLocator;
  resolvedText?: string;
  confidenceScore: ConfidenceScore;
};

export type CriticalFieldFinding = {
  segmentKey: string;
  originalMarker: string;
  fieldName: string;
  sourceText: string;
  locator: TargetLocator;
  resolvedText?: string;
  confidenceScore: ConfidenceScore;
};

export type PageExtraction = {
  pageNumber: number;
  renderReference: ArtifactReference;
  rawOcrReference: ArtifactReference;
  rawOcrText: string;
  normalizedText: string;
  handwrittenSegments: HandwrittenSegment[];
  checkboxFindings: CheckboxFinding[];
  criticalFieldFindings: CriticalFieldFinding[];
  confidenceScore: ConfidenceScore;
  enrichedText?: string;
};

export type FallbackTarget = {
  targetId: string;
  pageNumber?: number;
  targetType: ExtractionTargetType;
  targetLocator: TargetLocator;
  sourceText: string;
  fallbackReason: FallbackReason;
  isCritical: boolean;
  originalMarker?: string;
  maskedText?: string;
  promptText?: string;
  placeholderMap?: Record<string, string>;
  responseText?: string;
  maskedPromptReference?: ArtifactReference;
  llmResponseReference?: ArtifactReference;
  resolvedText?: string;
  confidenceScore: ConfidenceScore;
  warning?: JobWarning;
};
