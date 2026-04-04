import { Injectable } from '@nestjs/common';
import { PopplerPdfTools } from '@document-parser/shared-infrastructure';
import type { UploadedFile } from '../../../contracts/models';
import type { PageCounterPort } from '../../../contracts/ports';

@Injectable()
export class PdfInfoPageCounterAdapter implements PageCounterPort {
  public constructor(private readonly pdfTools = new PopplerPdfTools()) {}

  public async countPages(file: UploadedFile): Promise<number> {
    if (file.mimeType !== 'application/pdf') {
      return 1;
    }

    const { pageCount } = await this.pdfTools.inspect(file.buffer);
    return Math.max(1, pageCount);
  }
}
