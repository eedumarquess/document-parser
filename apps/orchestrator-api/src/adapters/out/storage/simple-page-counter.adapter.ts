import { Injectable } from '@nestjs/common';
import type { UploadedFile } from '../../../contracts/models';
import type { PageCounterPort } from '../../../contracts/ports';

@Injectable()
export class SimplePageCounterAdapter implements PageCounterPort {
  public async countPages(file: UploadedFile): Promise<number> {
    if (file.mimeType === 'application/pdf') {
      const raw = file.buffer.toString('utf8');
      const pageCount = raw.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
      return Math.max(pageCount, 1);
    }

    return 1;
  }
}

