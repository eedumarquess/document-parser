import { ValidationError } from '@document-parser/shared-kernel';
import { DocumentLimits } from '../value-objects/document-limits';
import { MimeType } from '../value-objects/mime-type';

export class DocumentAcceptancePolicy {
  public constructor(private readonly limits = new DocumentLimits()) {}

  public validate(input: { mimeType: string; fileSizeBytes: number; pageCount: number }): void {
    MimeType.create(input.mimeType);

    if (input.fileSizeBytes > this.limits.maxFileSizeBytes) {
      throw new ValidationError('File exceeds 50 MB limit', {
        fileSizeBytes: input.fileSizeBytes
      });
    }

    if (input.pageCount > this.limits.maxPages) {
      throw new ValidationError('Document exceeds 10 page limit', {
        pageCount: input.pageCount
      });
    }
  }
}

