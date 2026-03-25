import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@document-parser/shared-kernel';
import type { StorageReference } from '../../../contracts/models';
import type { BinaryStoragePort } from '../../../contracts/ports';

@Injectable()
export class InMemoryBinaryStorageAdapter implements BinaryStoragePort {
  private readonly objects = new Map<string, Buffer>();

  public async storeOriginal(input: {
    documentId: string;
    mimeType: string;
    originalName: string;
    buffer: Buffer;
  }): Promise<StorageReference> {
    const objectKey = `original/${input.documentId}/${input.originalName}`;
    this.objects.set(objectKey, Buffer.from(input.buffer));
    return {
      bucket: 'documents',
      objectKey
    };
  }

  public async read(storageReference: StorageReference): Promise<Buffer> {
    const buffer = this.objects.get(storageReference.objectKey);
    if (buffer === undefined) {
      throw new NotFoundError('Stored binary not found', storageReference);
    }
    return Buffer.from(buffer);
  }
}

