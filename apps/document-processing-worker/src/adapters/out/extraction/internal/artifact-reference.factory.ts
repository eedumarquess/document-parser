import { ArtifactType, type ArtifactReference } from '@document-parser/shared-kernel';
import type { FallbackTarget, RenderedPage } from '../../../../domain/extraction/extraction.types';

export class ArtifactReferenceFactory {
  public buildRenderArtifact(jobId: string, page: RenderedPage): ArtifactReference {
    const usesNativePdfRendering = page.imageBytes !== undefined;

    return {
      artifactId: `artifact-render-${jobId}-page-${page.pageNumber}`,
      artifactType: ArtifactType.RENDERED_IMAGE,
      storageBucket: 'artifacts',
      storageObjectKey: `render/${jobId}/page-${page.pageNumber}.png`,
      mimeType: page.mimeType,
      pageNumber: page.pageNumber,
      metadata: {
        renderedFrom: usesNativePdfRendering ? 'native-pdf-page-renderer' : 'default-page-renderer',
        pageSourceLength: page.sourceText.length,
        imageByteLength: page.imageBytes?.byteLength ?? 0
      }
    };
  }

  public buildRawOcrArtifact(
    jobId: string,
    pageNumber: number,
    rawOcr: { rawText: string; rawPayload: Record<string, unknown> }
  ): ArtifactReference {
    return {
      artifactId: `artifact-ocr-${jobId}-page-${pageNumber}`,
      artifactType: ArtifactType.OCR_JSON,
      storageBucket: 'artifacts',
      storageObjectKey: `ocr/${jobId}/page-${pageNumber}.json`,
      mimeType: 'application/json',
      pageNumber,
      metadata: {
        rawText: rawOcr.rawText,
        rawPayload: rawOcr.rawPayload
      }
    };
  }

  public buildMaskedTextArtifact(jobId: string, target: FallbackTarget, maskedText: string): ArtifactReference {
    return {
      artifactId: `artifact-masked-${jobId}-${target.targetId}`,
      artifactType: ArtifactType.MASKED_TEXT,
      storageBucket: 'artifacts',
      storageObjectKey: `masked/${jobId}/${target.targetId}.txt`,
      mimeType: 'text/plain',
      pageNumber: target.pageNumber,
      metadata: {
        targetId: target.targetId,
        maskedText,
        fallbackReason: target.fallbackReason
      }
    };
  }

  public buildPromptArtifact(jobId: string, target: FallbackTarget, promptText: string): ArtifactReference {
    return {
      artifactId: `artifact-prompt-${jobId}-${target.targetId}`,
      artifactType: ArtifactType.LLM_PROMPT,
      storageBucket: 'artifacts',
      storageObjectKey: `prompts/${jobId}/${target.targetId}.txt`,
      mimeType: 'text/plain',
      pageNumber: target.pageNumber,
      metadata: {
        targetId: target.targetId,
        promptText
      }
    };
  }

  public buildResponseArtifact(
    jobId: string,
    target: FallbackTarget,
    responseText: string,
    resolvedText?: string
  ): ArtifactReference {
    return {
      artifactId: `artifact-response-${jobId}-${target.targetId}`,
      artifactType: ArtifactType.LLM_RESPONSE,
      storageBucket: 'artifacts',
      storageObjectKey: `responses/${jobId}/${target.targetId}.txt`,
      mimeType: 'text/plain',
      pageNumber: target.pageNumber,
      metadata: {
        targetId: target.targetId,
        responseText,
        resolvedText
      }
    };
  }
}
