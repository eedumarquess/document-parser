export type MaskedText = {
  maskedText: string;
  placeholderMap: Record<string, string>;
};

export class SensitiveDataMaskingService {
  public maskForExternalLlm(text: string): MaskedText {
    const placeholderMap: Record<string, string> = {};
    const counters = {
      email: 0,
      cpf: 0,
      phone: 0
    };

    let maskedText = text;
    maskedText = this.maskPattern(maskedText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'email', counters, placeholderMap);
    maskedText = this.maskPattern(maskedText, /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, 'cpf', counters, placeholderMap);
    maskedText = this.maskPattern(maskedText, /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4}\b/g, 'phone', counters, placeholderMap);

    return {
      maskedText,
      placeholderMap
    };
  }

  public restoreMaskedText(text: string, placeholderMap: Record<string, string>): string {
    let restoredText = text;

    for (const [placeholder, originalValue] of Object.entries(placeholderMap)) {
      restoredText = restoredText.replaceAll(placeholder, originalValue);
    }

    return restoredText;
  }

  private maskPattern(
    text: string,
    pattern: RegExp,
    category: 'email' | 'cpf' | 'phone',
    counters: Record<'email' | 'cpf' | 'phone', number>,
    placeholderMap: Record<string, string>
  ): string {
    return text.replaceAll(pattern, (match) => {
      counters[category] += 1;
      const placeholder = `[${category}_${counters[category]}]`;
      placeholderMap[placeholder] = match;
      return placeholder;
    });
  }
}
