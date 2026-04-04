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
      const failure = error as {
        message?: unknown;
        code?: unknown;
        signal?: unknown;
        stdout?: unknown;
        stderr?: unknown;
      };

      throw new FatalFailureError('Native PDF/OCR command failed', {
        command,
        args,
        code: failure.code,
        signal: failure.signal,
        stdout: failure.stdout,
        stderr: failure.stderr,
        cause: typeof failure.message === 'string' ? failure.message : 'unknown'
      });
    }
  }
}
