import type { PageExtraction } from './extraction.types';

export class TextConsolidationService {
  public mergeFallbackResponsesIntoPageText(page: PageExtraction): string {
    let text = page.normalizedText;

    for (const segment of page.handwrittenSegments) {
      const replacement = segment.resolvedText === undefined ? '[manuscrito] [ilegivel]' : `[manuscrito] ${segment.resolvedText}`;
      text = text.replace(segment.originalMarker, replacement);
    }

    for (const checkbox of page.checkboxFindings) {
      const replacement = checkbox.resolvedText ?? `${checkbox.label}: [ilegivel]`;
      text = text.replace(checkbox.originalMarker, replacement);
    }

    for (const field of page.criticalFieldFindings) {
      const replacement = field.resolvedText === undefined ? `${field.fieldName}: [ilegivel]` : `${field.fieldName}: ${field.resolvedText}`;
      text = text.replace(field.originalMarker, replacement);
    }

    return text
      .replaceAll(/[ \t]+/g, ' ')
      .replaceAll(/\n{3,}/g, '\n\n')
      .trim();
  }

  public buildConsolidatedDocumentText(pages: PageExtraction[]): string {
    return pages
      .map((page) => page.enrichedText?.trim() ?? '')
      .filter((pageText) => pageText.length > 0)
      .join('\n\n')
      .trim();
  }
}
