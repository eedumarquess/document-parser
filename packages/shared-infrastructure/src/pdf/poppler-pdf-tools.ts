import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { FatalFailureError } from '@document-parser/shared-kernel';
import { NativeCommandRunner } from '../native/native-command-runner';
import { withTemporaryFile } from '../native/temporary-workspace';

export class PopplerPdfTools {
  public constructor(
    private readonly runner = new NativeCommandRunner(),
    private readonly pdfinfoBinary = process.env.PDFINFO_BINARY?.trim() || 'pdfinfo',
    private readonly pdftoppmBinary = process.env.PDFTOPPM_BINARY?.trim() || 'pdftoppm'
  ) {}

  public async inspect(buffer: Buffer): Promise<{ pageCount: number }> {
    return withTemporaryFile(buffer, '.pdf', async (filePath) => {
      const { stdout } = await this.runner.run(this.pdfinfoBinary, [filePath]);
      const match = stdout.match(/^\s*Pages:\s+(\d+)\s*$/m);

      if (match === null) {
        throw new FatalFailureError('Unable to determine PDF page count via pdfinfo', {
          tool: this.pdfinfoBinary
        });
      }

      return { pageCount: Number(match[1]) };
    });
  }

  public async renderPages(
    buffer: Buffer
  ): Promise<
    Array<{
      pageNumber: number;
      mimeType: 'image/png';
      imageBytes: Buffer;
      sourceText: string;
    }>
  > {
    return withTemporaryFile(buffer, '.pdf', async (filePath) => {
      const outputPrefix = `${filePath}-page`;
      await this.runner.run(this.pdftoppmBinary, ['-png', filePath, outputPrefix]);

      const directory = dirname(filePath);
      const prefix = `${basename(outputPrefix)}-`;
      const imageFiles = (await readdir(directory))
        .filter((name) => name.startsWith(prefix) && name.endsWith('.png'))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

      return Promise.all(
        imageFiles.map(async (name, index) => ({
          pageNumber: index + 1,
          mimeType: 'image/png' as const,
          imageBytes: await readFile(join(directory, name)),
          sourceText: ''
        }))
      );
    });
  }
}
