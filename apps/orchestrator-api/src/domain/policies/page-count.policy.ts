import { Injectable } from '@nestjs/common';
import type { UploadedFile } from '../../contracts/models';
import type { PageCounterPort } from '../../contracts/ports';

@Injectable()
export class PageCountPolicy {
  public async countPages(input: {
    file: UploadedFile;
    pageCounter: PageCounterPort;
  }): Promise<number> {
    if (input.file.mimeType === 'image/jpeg' || input.file.mimeType === 'image/png') {
      return 1;
    }

    return input.pageCounter.countPages(input.file);
  }
}
