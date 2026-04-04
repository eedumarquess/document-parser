import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function withTemporaryFile<T>(
  buffer: Buffer,
  extension: string,
  work: (filePath: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'document-parser-'));
  const filePath = join(directory, `input${extension}`);

  await writeFile(filePath, buffer);

  try {
    return await work(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
