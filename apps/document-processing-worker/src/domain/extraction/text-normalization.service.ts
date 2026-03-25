export class TextNormalizationService {
  public normalizeOcrTextByPage(rawText: string): string {
    return rawText
      .replaceAll(/\r\n/g, '\n')
      .replaceAll(/%PDF-[^\n]*\n?/g, '')
      .replaceAll(/\/Type \/Page\n?/g, '')
      .replaceAll(/\[\[(?:PAGE_BREAK|LOW_CONFIDENCE|OCR_EMPTY|LLM_UNAVAILABLE)\]\]/g, ' ')
      .replaceAll(/\[\[CHECKED:([^\]]+)\]\]/g, '$1: [marcado]')
      .replaceAll(/\[\[UNCHECKED:([^\]]+)\]\]/g, '$1: [desmarcado]')
      .replaceAll(/(^|\s)checkbox:([^:\s]+):checked/gi, '$1$2: [marcado]')
      .replaceAll(/(^|\s)checkbox:([^:\s]+):unchecked/gi, '$1$2: [desmarcado]')
      .replaceAll(/\[\[ILLEGIBLE\]\]/g, '[ilegivel]')
      .replaceAll(/[ \t]+/g, ' ')
      .replaceAll(/\n{3,}/g, '\n\n')
      .trim();
  }

  public buildReadableSourceText(sourceText: string): string {
    return sourceText
      .replaceAll(/%PDF-[^\n]*\n?/g, '')
      .replaceAll(/\/Type \/Page\n?/g, '')
      .replaceAll(/\[\[(?:PAGE_BREAK|LOW_CONFIDENCE|OCR_EMPTY)\]\]/g, ' ')
      .replaceAll(/\[\[CHECKED:([^\]]+)\]\]/g, '$1: [marcado]')
      .replaceAll(/\[\[UNCHECKED:([^\]]+)\]\]/g, '$1: [desmarcado]')
      .replaceAll(/\[\[AMBIGUOUS_CHECKBOX:([^:\]]+):(checked|unchecked)\]\]/g, 'checkbox:$1:$2')
      .replaceAll(/\[\[HANDWRITING:([^\]]+)\]\]/g, '$1')
      .replaceAll(/\[\[CRITICAL_MISSING:([^:\]]+):([^\]]+)\]\]/g, '$1: $2')
      .replaceAll(/\[\[ILLEGIBLE\]\]/g, '[ilegivel]')
      .replaceAll(/[ \t]+/g, ' ')
      .replaceAll(/\n{3,}/g, '\n\n')
      .trim();
  }
}
