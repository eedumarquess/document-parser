import { Injectable } from '@nestjs/common';
import { DocumentEntity } from '../entities/document.entity';
import type { DocumentRecord, UploadedFile } from '../../contracts/models';
import type { BinaryStoragePort, IdGeneratorPort } from '../../contracts/ports';
import { RetentionPolicyService } from '../services/retention-policy.service';

@Injectable()
export class DocumentStoragePolicy {
  public constructor(private readonly retentionPolicy: RetentionPolicyService) {}

  public async storeCanonicalDocument(input: {
    existingDocument?: DocumentRecord;
    file: UploadedFile;
    hash: string;
    pageCount: number;
    now: Date;
    idGenerator: IdGeneratorPort;
    storage: BinaryStoragePort;
  }): Promise<{ document: DocumentRecord; storedNewBinary: boolean }> {
    if (input.existingDocument !== undefined) {
      return {
        document: input.existingDocument,
        storedNewBinary: false
      };
    }

    const documentId = input.idGenerator.next('doc');
    const storageReference = await input.storage.storeOriginal({
      documentId,
      mimeType: input.file.mimeType,
      originalName: input.file.originalName,
      buffer: input.file.buffer
    });

    return {
      document: DocumentEntity.create({
        documentId,
        hash: input.hash,
        originalFileName: input.file.originalName,
        mimeType: input.file.mimeType,
        fileSizeBytes: input.file.size,
        pageCount: input.pageCount,
        storageReference,
        retentionUntil: this.retentionPolicy.calculateOriginalRetentionUntil(input.now),
        now: input.now
      }),
      storedNewBinary: true
    };
  }
}
