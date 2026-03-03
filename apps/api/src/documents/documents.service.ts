import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentProcessingMessage, DocumentStatus } from '@app/contracts';
import { DocumentEntity } from '@app/db';
import {
  DOCUMENTS_PROCESS_ROUTING_KEY,
  RabbitMqService,
} from '@app/messaging';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, extname, join } from 'path';
import { DataSource, Repository } from 'typeorm';

type DocumentResponse = {
  id: string;
  status: DocumentStatus;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepository: Repository<DocumentEntity>,
    private readonly dataSource: DataSource,
    private readonly rabbitMqService: RabbitMqService,
  ) {}

  async createDocument(file: Express.Multer.File, rawMetadata?: string) {
    const metadata = this.parseMetadata(rawMetadata);
    const safeOriginalFilename = this.sanitizeFilename(file.originalname);
    const extension = extname(safeOriginalFilename);
    const storedFilename = `${randomUUID()}${extension}`;
    const storageRoot = process.env.DOCUMENT_STORAGE_PATH ?? './data/documents';
    const storagePath = join(storageRoot, storedFilename);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const documentId = randomUUID();
    const correlationId = randomUUID();

    await fs.mkdir(storageRoot, { recursive: true });
    await fs.writeFile(storagePath, file.buffer, { mode: 0o600 });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const document = queryRunner.manager.create(DocumentEntity, {
        id: documentId,
        originalFilename: safeOriginalFilename,
        storedFilename,
        storagePath,
        mimeType: file.mimetype,
        sizeBytes: String(file.size),
        checksumSha256: checksum,
        metadata,
        status: DocumentStatus.QUEUED,
        attempts: 0,
        lastError: null,
        processedAt: null,
      });

      const savedDocument = await queryRunner.manager.save(document);

      const message: DocumentProcessingMessage = {
        version: 1,
        documentId: savedDocument.id,
        storagePath: savedDocument.storagePath,
        mimeType: savedDocument.mimeType,
        attempt: 1,
        correlationId,
        enqueuedAt: new Date().toISOString(),
      };

      await this.rabbitMqService.publish(
        DOCUMENTS_PROCESS_ROUTING_KEY,
        message,
        { correlationId },
      );
      await queryRunner.commitTransaction();

      this.log('document_queued', {
        documentId: savedDocument.id,
        correlationId,
      });

      return {
        id: savedDocument.id,
        status: savedDocument.status,
        createdAt: savedDocument.createdAt.toISOString(),
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      await fs.unlink(storagePath).catch(() => undefined);
      throw new InternalServerErrorException('Failed to queue document');
    } finally {
      await queryRunner.release();
    }
  }

  async getDocument(documentId: string): Promise<DocumentResponse> {
    const document = await this.documentsRepository.findOne({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return {
      id: document.id,
      status: document.status,
      filename: document.originalFilename,
      mimeType: document.mimeType,
      sizeBytes: Number(document.sizeBytes),
      attempts: document.attempts,
      lastError: document.lastError,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      processedAt: document.processedAt?.toISOString() ?? null,
    };
  }

  private parseMetadata(rawMetadata?: string): Record<string, unknown> | null {
    if (!rawMetadata) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawMetadata);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Metadata must be a JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException('metadata must be a valid JSON object string');
    }
  }

  private sanitizeFilename(filename: string): string {
    return basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private log(event: string, payload: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        level: 'info',
        context: 'DocumentsService',
        event,
        ...payload,
      }),
    );
  }
}
