export class SensitiveDataMaskingService {
  public maskForExternalLlm(text: string): string {
    return text
      .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replaceAll(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
      .replaceAll(/\b\d{2}\s?\d{4,5}-?\d{4}\b/g, '[phone]')
      .replaceAll(/\d/g, '*');
  }
}
