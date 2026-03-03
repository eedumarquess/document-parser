import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentProcessingMessage, DocumentStatus } from '@app/contracts';
import { DocumentEntity } from '@app/db';
import {
  DOCUMENTS_DLQ_ROUTING_KEY,
  DOCUMENTS_RETRY_ROUTING_KEY,
  MAX_ATTEMPTS,
  RabbitMqService,
} from '@app/messaging';
import { promises as fs } from 'fs';
import { Message } from 'amqplib';
import { Repository } from 'typeorm';

@Injectable()
export class WorkerConsumerService implements OnModuleInit {
  private processedCount = 0;
  private failedCount = 0;

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepository: Repository<DocumentEntity>,
    private readonly rabbitMqService: RabbitMqService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitMqService.consumeProcessQueue(async (message, payload) => {
      await this.handleMessage(message, payload as DocumentProcessingMessage);
    });
    this.log('worker_consumer_started', {});
  }

  getStats(): { processedCount: number; failedCount: number } {
    return {
      processedCount: this.processedCount,
      failedCount: this.failedCount,
    };
  }

  private async handleMessage(
    message: Message,
    payload: DocumentProcessingMessage,
  ): Promise<void> {
    const correlationId =
      payload.correlationId ||
      message.properties.correlationId ||
      payload.documentId;
    let document: DocumentEntity | null = null;

    try {
      document = await this.documentsRepository.findOne({
        where: { id: payload.documentId },
      });
      if (!document) {
        this.log('document_not_found_ack', {
          correlationId,
          documentId: payload.documentId,
        });
        return;
      }

      if (document.status === DocumentStatus.PROCESSED) {
        this.log('document_already_processed_ack', {
          correlationId,
          documentId: document.id,
        });
        return;
      }

      await this.documentsRepository.update(
        { id: document.id },
        { status: DocumentStatus.PROCESSING },
      );

      await this.runProcessingStub(document);

      await this.documentsRepository.update(
        { id: document.id },
        {
          status: DocumentStatus.PROCESSED,
          processedAt: new Date(),
          lastError: null,
        },
      );
      this.processedCount += 1;
      this.log('document_processed', {
        correlationId,
        documentId: document.id,
        attempt: payload.attempt,
      });
    } catch (error) {
      this.failedCount += 1;
      if (!document) {
        this.log('processing_failed_document_missing', {
          correlationId,
          documentId: payload.documentId,
          error: (error as Error).message,
        });
        return;
      }

      const attempts = document.attempts + 1;
      const lastError = (error as Error).message;
      const isLastAttempt = attempts >= MAX_ATTEMPTS;
      const nextStatus = isLastAttempt ? DocumentStatus.DLQ : DocumentStatus.FAILED;

      await this.documentsRepository.update(
        { id: document.id },
        {
          attempts,
          status: nextStatus,
          lastError,
        },
      );

      if (isLastAttempt) {
        await this.rabbitMqService.publish(
          DOCUMENTS_DLQ_ROUTING_KEY,
          {
            ...payload,
            attempt: attempts,
            enqueuedAt: new Date().toISOString(),
          },
          {
            correlationId,
          },
        );
        this.log('document_sent_to_dlq', {
          correlationId,
          documentId: document.id,
          attempts,
          error: lastError,
        });
      } else {
        await this.rabbitMqService.publish(
          DOCUMENTS_RETRY_ROUTING_KEY,
          {
            ...payload,
            attempt: attempts + 1,
            enqueuedAt: new Date().toISOString(),
          },
          {
            correlationId,
          },
        );
        this.log('document_sent_to_retry', {
          correlationId,
          documentId: document.id,
          attempts,
          error: lastError,
        });
      }
    } finally {
      this.rabbitMqService.ack(message);
    }
  }

  private async runProcessingStub(document: DocumentEntity): Promise<void> {
    await fs.access(document.storagePath);

    const forceFail =
      document.metadata &&
      typeof document.metadata === 'object' &&
      document.metadata['forceFail'] === true;

    if (forceFail) {
      throw new Error('Forced failure from metadata.forceFail');
    }
  }

  private log(event: string, payload: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        level: 'info',
        context: 'WorkerConsumerService',
        event,
        ...payload,
      }),
    );
  }
}
