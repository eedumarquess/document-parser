import type { Readable } from 'node:stream';
import { Client } from 'minio';
import { NotFoundError } from '@document-parser/shared-kernel';
import type { StorageReference } from '../../../contracts/models';
import type { BinaryStoragePort } from '../../../contracts/ports';

export class MinioBinaryStorageAdapter implements BinaryStoragePort {
  private readonly client: Client;
  private bucketEnsured = false;

  public constructor(input: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
  }) {
    this.bucket = input.bucket;
    this.client = new Client({
      endPoint: input.endPoint,
      port: input.port,
      useSSL: input.useSSL,
      accessKey: input.accessKey,
      secretKey: input.secretKey
    });
  }

  private readonly bucket: string;

  public async storeOriginal(input: {
    documentId: string;
    mimeType: string;
    originalName: string;
    buffer: Buffer;
  }): Promise<StorageReference> {
    await this.ensureBucket();
    const objectKey = `original/${input.documentId}/${sanitizeFileName(input.originalName)}`;
    await this.client.putObject(this.bucket, objectKey, input.buffer, input.buffer.byteLength, {
      'Content-Type': input.mimeType
    });

    return {
      bucket: this.bucket,
      objectKey
    };
  }

  public async read(storageReference: StorageReference): Promise<Buffer> {
    await this.ensureBucket();

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

  public async delete(storageReference: StorageReference): Promise<void> {
    await this.ensureBucket();
    await this.client.removeObject(storageReference.bucket, storageReference.objectKey);
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) {
      return;
    }

    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
    this.bucketEnsured = true;
  }
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/]/g, '_');
}
