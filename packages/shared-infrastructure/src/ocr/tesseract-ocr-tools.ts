import { NativeCommandRunner } from '../native/native-command-runner';
import { withTemporaryFile } from '../native/temporary-workspace';

export class TesseractOcrTools {
  public constructor(
    private readonly runner = new NativeCommandRunner(),
    private readonly binary = process.env.TESSERACT_BINARY?.trim() || 'tesseract',
    private readonly language = process.env.TESSERACT_LANGUAGE?.trim() || 'por'
  ) {}

  public async recognize(imageBytes: Buffer): Promise<{
    text: string;
    confidenceScore: number;
    rawPayload: Record<string, unknown>;
  }> {
    return withTemporaryFile(imageBytes, '.png', async (filePath) => {
      const { stdout, stderr } = await this.runner.run(this.binary, [filePath, 'stdout', '-l', this.language]);
      const text = stdout.trim();

      return {
        text,
        confidenceScore: text === '' ? 0.12 : 0.9,
        rawPayload: {
          provider: 'tesseract',
          language: this.language,
          stderr
        }
      };
    });
  }
}
