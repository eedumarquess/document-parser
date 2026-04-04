import { Injectable } from '@nestjs/common';
import { ArtifactType, RedactionPolicyService } from '@document-parser/shared-kernel';
import type { ArtifactOperationalResponse } from '../../contracts/http';
import type { PageArtifactRecord } from '../../contracts/models';

const PREVIEW_MAX_LENGTH = 240;
const PDF_BINARY_MARKERS = [
  /%pdf-/i,
  /flatedecode/i
];
const PDF_STRUCTURAL_MARKERS = [
  /\/type\s*\/page\b/i,
  /\b\d+\s+\d+\s+obj\b/i,
  /\bendobj\b/i,
  /(^|[\r\n])\s*xref(\s|$)/i,
  /\bendstream\b/i,
  /\bstream\b[\s\S]{0,200}\b(?:endobj|endstream)\b/i
];

type PreviewStrategy = {
  extract(metadata: Record<string, unknown>): unknown;
  requiresReadableText?: boolean;
};

const PREVIEW_SOURCE_STRATEGIES: Record<string, PreviewStrategy> = {
  [ArtifactType.OCR_JSON]: {
    extract: (metadata) => metadata.rawText ?? metadata.rawPayload,
    requiresReadableText: true
  },
  [ArtifactType.MASKED_TEXT]: {
    extract: (metadata) => metadata.maskedText
  },
  [ArtifactType.LLM_PROMPT]: {
    extract: (metadata) => metadata.promptText
  },
  [ArtifactType.LLM_RESPONSE]: {
    extract: (metadata) => metadata.resolvedText ?? metadata.responseText
  }
};

@Injectable()
export class ArtifactPreviewService {
  public constructor(private readonly redactionPolicy: RedactionPolicyService) {}

  public toResponse(artifact: PageArtifactRecord): ArtifactOperationalResponse {
    const previewText = this.buildPreviewText(artifact);
    const metadata = this.buildSanitizedMetadata(artifact);

    return {
      artifactId: artifact.artifactId,
      artifactType: artifact.artifactType,
      pageNumber: artifact.pageNumber,
      mimeType: artifact.mimeType,
      storageBucket: artifact.storageBucket,
      storageObjectKey: artifact.storageObjectKey,
      metadata,
      previewText,
      createdAt: artifact.createdAt.toISOString(),
      retentionUntil: artifact.retentionUntil.toISOString()
    };
  }

  private buildPreviewText(artifact: PageArtifactRecord): string | undefined {
    const preview = this.extractPreview(artifact);
    if (preview === undefined) {
      return undefined;
    }
    if (preview.requiresReadableText && !this.isReadableText(preview.previewSource)) {
      return undefined;
    }

    const masked = this.redactionPolicy.maskTextPreview(preview.previewSource);
    const normalized = masked.replaceAll(/\s+/g, ' ').trim();
    if (normalized === '') {
      return undefined;
    }

    return normalized.length <= PREVIEW_MAX_LENGTH
      ? normalized
      : `${normalized.slice(0, PREVIEW_MAX_LENGTH - 3)}...`;
  }

  private buildSanitizedMetadata(artifact: PageArtifactRecord): Record<string, unknown> | undefined {
    const metadata = { ...(artifact.metadata ?? {}) };

    delete metadata.rawText;
    delete metadata.rawPayload;
    delete metadata.maskedText;
    delete metadata.promptText;
    delete metadata.responseText;
    delete metadata.resolvedText;

    if (Object.keys(metadata).length === 0) {
      return undefined;
    }

    return this.redactionPolicy.sanitizeMetadata(metadata, {
      context: 'artifact'
    });
  }

  private extractPreview(
    artifact: PageArtifactRecord
  ): { previewSource: string; requiresReadableText: boolean } | undefined {
    const metadata = artifact.metadata ?? {};

    const strategy = PREVIEW_SOURCE_STRATEGIES[artifact.artifactType];
    if (strategy === undefined) {
      return undefined;
    }

    const previewSource = this.serializePreviewCandidate(strategy.extract(metadata));
    if (previewSource === undefined) {
      return undefined;
    }

    return {
      previewSource,
      requiresReadableText: strategy.requiresReadableText ?? false
    };
  }

  private serializePreviewCandidate(candidate: unknown): string | undefined {
    if (typeof candidate === 'string') {
      return candidate;
    }
    if (candidate === undefined || candidate === null) {
      return undefined;
    }

    try {
      return JSON.stringify(candidate);
    } catch {
      return undefined;
    }
  }

  private isReadableText(candidate: string): boolean {
    if (this.hasBinaryControlCharacters(candidate)) {
      return false;
    }

    return !this.looksLikePdfStructure(candidate);
  }

  private hasBinaryControlCharacters(candidate: string): boolean {
    for (const character of candidate) {
      const code = character.charCodeAt(0);
      if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
        return true;
      }
    }

    return false;
  }

  private looksLikePdfStructure(candidate: string): boolean {
    if (PDF_BINARY_MARKERS.some((pattern) => pattern.test(candidate))) {
      return true;
    }

    const structuralSignalCount = PDF_STRUCTURAL_MARKERS.reduce(
      (count, pattern) => count + (pattern.test(candidate) ? 1 : 0),
      0
    );

    return structuralSignalCount >= 2;
  }
}
