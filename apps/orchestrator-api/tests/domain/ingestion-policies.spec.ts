import { buildUploadedFile } from '@document-parser/testkit';
import { InMemoryBinaryStorageAdapter } from '../../src/adapters/out/storage/in-memory-binary-storage.adapter';
import { PageCountPolicy } from '../../src/domain/policies/page-count.policy';
import { DocumentStoragePolicy } from '../../src/domain/policies/document-storage.policy';
import { RetentionPolicyService } from '../../src/domain/services/retention-policy.service';

class StubIdGenerator {
  public next(prefix: string): string {
    return `${prefix}-1`;
  }
}

describe('PageCountPolicy', () => {
  const policy = new PageCountPolicy();

  it('returns one page for JPEG and PNG without delegating', async () => {
    const counterCalls: string[] = [];
    const pageCounter = {
      async countPages(): Promise<number> {
        counterCalls.push('called');
        return 99;
      }
    };

    await expect(
      policy.countPages({
        file: buildUploadedFile({ mimeType: 'image/jpeg' }),
        pageCounter
      })
    ).resolves.toBe(1);
    await expect(
      policy.countPages({
        file: buildUploadedFile({ mimeType: 'image/png' }),
        pageCounter
      })
    ).resolves.toBe(1);
    expect(counterCalls).toHaveLength(0);
  });

  it('delegates PDF counting to the page counter port', async () => {
    const pageCounter = {
      async countPages(): Promise<number> {
        return 7;
      }
    };

    await expect(
      policy.countPages({
        file: buildUploadedFile({ mimeType: 'application/pdf' }),
        pageCounter
      })
    ).resolves.toBe(7);
  });
});

describe('DocumentStoragePolicy', () => {
  const policy = new DocumentStoragePolicy(new RetentionPolicyService());

  it('reuses the existing canonical document when the hash already exists', async () => {
    const existingDocument = {
      documentId: 'doc-existing',
      hash: 'sha256:existing',
      originalFileName: 'existing.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 100,
      pageCount: 2,
      sourceType: 'MULTIPART' as const,
      storageReference: {
        bucket: 'documents',
        objectKey: 'original/doc-existing/existing.pdf'
      },
      retentionUntil: new Date('2026-04-25T12:00:00.000Z'),
      createdAt: new Date('2026-03-25T12:00:00.000Z'),
      updatedAt: new Date('2026-03-25T12:00:00.000Z')
    };
    const storage = new InMemoryBinaryStorageAdapter();

    const result = await policy.storeCanonicalDocument({
      existingDocument,
      file: buildUploadedFile(),
      hash: existingDocument.hash,
      pageCount: 2,
      now: new Date('2026-03-25T12:00:00.000Z'),
      idGenerator: new StubIdGenerator(),
      storage
    });

    expect(result.document).toBe(existingDocument);
    expect(result.storedNewBinary).toBe(false);
  });

  it('stores a new binary and builds a canonical document when the hash is new', async () => {
    const storage = new InMemoryBinaryStorageAdapter();
    const file = buildUploadedFile({
      originalName: 'incoming.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('pdf bytes')
    });

    const result = await policy.storeCanonicalDocument({
      file,
      hash: 'sha256:new',
      pageCount: 3,
      now: new Date('2026-03-25T12:00:00.000Z'),
      idGenerator: new StubIdGenerator(),
      storage
    });

    expect(result.storedNewBinary).toBe(true);
    expect(result.document).toMatchObject({
      documentId: 'doc-1',
      hash: 'sha256:new',
      originalFileName: 'incoming.pdf',
      mimeType: 'application/pdf',
      pageCount: 3
    });
    await expect(storage.read(result.document.storageReference)).resolves.toEqual(Buffer.from('pdf bytes'));
  });
});
