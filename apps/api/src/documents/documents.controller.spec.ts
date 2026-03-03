import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentStatus } from '@app/contracts';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let service: jest.Mocked<DocumentsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        {
          provide: DocumentsService,
          useValue: {
            createDocument: jest.fn(),
            getDocument: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(DocumentsController);
    service = module.get(DocumentsService);
  });

  it('throws when file is missing', async () => {
    await expect(controller.uploadDocument(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('queues document on valid upload', async () => {
    service.createDocument.mockResolvedValue({
      id: '8ea7e6b4-5054-4ad4-9a0e-ab3a2fd5a0ac',
      status: DocumentStatus.QUEUED,
      createdAt: '2026-03-03T00:00:00.000Z',
    });

    const file = {
      originalname: 'sample.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('hello'),
      size: 5,
    } as Express.Multer.File;

    const result = await controller.uploadDocument(file, '{"source":"test"}');

    expect(service.createDocument).toHaveBeenCalledWith(
      file,
      '{"source":"test"}',
    );
    expect(result.status).toBe(DocumentStatus.QUEUED);
  });

  it('returns document by id', async () => {
    service.getDocument.mockResolvedValue({
      id: '8ea7e6b4-5054-4ad4-9a0e-ab3a2fd5a0ac',
      status: DocumentStatus.PROCESSED,
      filename: 'sample.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      attempts: 0,
      lastError: null,
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:10.000Z',
      processedAt: '2026-03-03T00:00:10.000Z',
    });

    const result = await controller.getDocument(
      '8ea7e6b4-5054-4ad4-9a0e-ab3a2fd5a0ac',
    );

    expect(result.status).toBe(DocumentStatus.PROCESSED);
    expect(service.getDocument).toHaveBeenCalled();
  });
});
