import { ValidationError } from '@document-parser/shared-kernel';

export class DocumentHash {
  private constructor(public readonly value: string) {}

  public static create(value: string): DocumentHash {
    if (!value.startsWith('sha256:')) {
      throw new ValidationError('Hash must use sha256 prefix', { hash: value });
    }
    return new DocumentHash(value);
  }
}

