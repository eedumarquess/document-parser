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
    const previewSource = this.extractPreviewSource(artifact);
    if (previewSource === undefined) {
      return undefined;
    }
    if (artifact.artifactType === ArtifactType.OCR_JSON && !this.isReadableText(previewSource)) {
      return undefined;
    }

    const masked = this.redactionPolicy.maskTextPreview(previewSource);
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
    }) as Record<string, unknown>;
  }

  private extractPreviewSource(artifact: PageArtifactRecord): string | undefined {
    const metadata = artifact.metadata ?? {};

    switch (artifact.artifactType) {
      case ArtifactType.OCR_JSON:
        return this.serializePreviewCandidate(metadata.rawText ?? metadata.rawPayload);
      case ArtifactType.MASKED_TEXT:
        return this.serializePreviewCandidate(metadata.maskedText);
      case ArtifactType.LLM_PROMPT:
        return this.serializePreviewCandidate(metadata.promptText);
      case ArtifactType.LLM_RESPONSE:
        return this.serializePreviewCandidate(metadata.resolvedText ?? metadata.responseText);
      default:
        return undefined;
    }
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
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(candidate)) {
      return false;
    }

    return !this.looksLikePdfStructure(candidate);
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
