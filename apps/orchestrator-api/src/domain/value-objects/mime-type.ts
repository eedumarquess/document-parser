import { ValidationError } from '@document-parser/shared-kernel';

export const SUPPORTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export class MimeType {
  private constructor(public readonly value: string) {}

  public static create(value: string): MimeType {
    if (!SUPPORTED_MIME_TYPES.includes(value as (typeof SUPPORTED_MIME_TYPES)[number])) {
      throw new ValidationError('Unsupported MIME type', { mimeType: value });
    }
    return new MimeType(value);
  }
}

