import type { Readable } from 'node:stream';
import { Client } from 'minio';
import { NotFoundError } from '@document-parser/shared-kernel';
import type { StorageReference } from '../../../contracts/models';
import type { BinaryStoragePort } from '../../../contracts/ports';

export class MinioBinaryStorageAdapter implements BinaryStoragePort {
  private readonly client: Client;

  public constructor(input: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
  }) {
    this.client = new Client({
      endPoint: input.endPoint,
      port: input.port,
      useSSL: input.useSSL,
      accessKey: input.accessKey,
      secretKey: input.secretKey
    });
  }

  public async read(storageReference: StorageReference): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(storageReference.bucket, storageReference.objectKey);
      return readStreamToBuffer(stream);
    } catch (error) {
      throw new NotFoundError('Stored binary not found', {
        bucket: storageReference.bucket,
        objectKey: storageReference.objectKey,
        message: error instanceof Error ? error.message : 'Unknown MinIO read failure'
      });
    }
  }
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
