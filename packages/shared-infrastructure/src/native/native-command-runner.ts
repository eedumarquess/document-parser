import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FatalFailureError } from '@document-parser/shared-kernel';

const execFileAsync = promisify(execFile);

export class NativeCommandRunner {
  public async run(command: string, args: string[]) {
    try {
      return await execFileAsync(command, args, {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      });
    } catch (error) {
      throw new FatalFailureError('Native PDF/OCR command failed', {
        command,
        args,
        cause: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
}
