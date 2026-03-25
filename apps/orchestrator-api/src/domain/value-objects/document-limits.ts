import { MAX_FILE_SIZE_BYTES, MAX_PAGES } from '@document-parser/shared-kernel';

export class DocumentLimits {
  public readonly maxFileSizeBytes = MAX_FILE_SIZE_BYTES;
  public readonly maxPages = MAX_PAGES;
}

