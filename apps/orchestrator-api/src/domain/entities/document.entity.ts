import type { DocumentRecord, StorageReference } from '../../contracts/models';

export class DocumentEntity {
  public static create(input: {
    documentId: string;
    hash: string;
    originalFileName: string;
    mimeType: string;
    fileSizeBytes: number;
    pageCount: number;
    storageReference: StorageReference;
    retentionUntil: Date;
    now: Date;
  }): DocumentRecord {
    return {
      documentId: input.documentId,
      hash: input.hash,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      pageCount: input.pageCount,
      sourceType: 'MULTIPART',
      storageReference: input.storageReference,
      retentionUntil: input.retentionUntil,
      createdAt: input.now,
      updatedAt: input.now
    };
  }
}

