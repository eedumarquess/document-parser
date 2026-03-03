import { DocumentStatus } from '@app/contracts';
import {
  DOCUMENTS_DLQ_ROUTING_KEY,
  DOCUMENTS_RETRY_ROUTING_KEY,
  RabbitMqService,
} from '@app/messaging';
import { promises as fs } from 'fs';
import { Repository } from 'typeorm';
import { WorkerConsumerService } from './worker.consumer';

describe('WorkerConsumerService', () => {
  let service: WorkerConsumerService;
  let documentsRepository: jest.Mocked<Repository<any>>;
  let rabbitMqService: jest.Mocked<RabbitMqService>;

  beforeEach(() => {
    documentsRepository = {
      findOne: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<Repository<any>>;

    rabbitMqService = {
      consumeProcessQueue: jest.fn(),
      ack: jest.fn(),
      publish: jest.fn(),
    } as unknown as jest.Mocked<RabbitMqService>;

    service = new WorkerConsumerService(documentsRepository, rabbitMqService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('acks and skips when document is already processed', async () => {
    documentsRepository.findOne.mockResolvedValue({
      id: 'doc-1',
      status: DocumentStatus.PROCESSED,
    });

    await (service as any).handleMessage(
      { properties: {} },
      {
        documentId: 'doc-1',
        correlationId: 'corr-1',
        attempt: 1,
      },
    );

    expect(rabbitMqService.ack).toHaveBeenCalled();
    expect(documentsRepository.update).not.toHaveBeenCalled();
  });

  it('marks as processed on successful processing', async () => {
    jest.spyOn(fs, 'access').mockResolvedValue(undefined);
    documentsRepository.findOne.mockResolvedValue({
      id: 'doc-2',
      status: DocumentStatus.QUEUED,
      attempts: 0,
      storagePath: '/tmp/doc.txt',
      metadata: null,
    });

    await (service as any).handleMessage(
      { properties: {} },
      {
        documentId: 'doc-2',
        correlationId: 'corr-2',
        attempt: 1,
      },
    );

    expect(documentsRepository.update).toHaveBeenCalledWith(
      { id: 'doc-2' },
      expect.objectContaining({ status: DocumentStatus.PROCESSING }),
    );
    expect(documentsRepository.update).toHaveBeenCalledWith(
      { id: 'doc-2' },
      expect.objectContaining({ status: DocumentStatus.PROCESSED }),
    );
    expect(rabbitMqService.ack).toHaveBeenCalled();
  });

  it('sends to retry queue when attempts remain', async () => {
    jest.spyOn(fs, 'access').mockRejectedValue(new Error('missing file'));
    documentsRepository.findOne.mockResolvedValue({
      id: 'doc-3',
      status: DocumentStatus.QUEUED,
      attempts: 0,
      storagePath: '/tmp/missing.txt',
      metadata: null,
    });

    await (service as any).handleMessage(
      { properties: {} },
      {
        documentId: 'doc-3',
        correlationId: 'corr-3',
        attempt: 1,
      },
    );

    expect(rabbitMqService.publish).toHaveBeenCalledWith(
      DOCUMENTS_RETRY_ROUTING_KEY,
      expect.objectContaining({ documentId: 'doc-3' }),
      expect.objectContaining({ correlationId: 'corr-3' }),
    );
    expect(documentsRepository.update).toHaveBeenCalledWith(
      { id: 'doc-3' },
      expect.objectContaining({ status: DocumentStatus.FAILED, attempts: 1 }),
    );
    expect(rabbitMqService.ack).toHaveBeenCalled();
  });

  it('sends to DLQ when max attempts reached', async () => {
    jest.spyOn(fs, 'access').mockRejectedValue(new Error('missing file'));
    documentsRepository.findOne.mockResolvedValue({
      id: 'doc-4',
      status: DocumentStatus.FAILED,
      attempts: 2,
      storagePath: '/tmp/missing.txt',
      metadata: null,
    });

    await (service as any).handleMessage(
      { properties: {} },
      {
        documentId: 'doc-4',
        correlationId: 'corr-4',
        attempt: 3,
      },
    );

    expect(rabbitMqService.publish).toHaveBeenCalledWith(
      DOCUMENTS_DLQ_ROUTING_KEY,
      expect.objectContaining({ documentId: 'doc-4' }),
      expect.objectContaining({ correlationId: 'corr-4' }),
    );
    expect(documentsRepository.update).toHaveBeenCalledWith(
      { id: 'doc-4' },
      expect.objectContaining({ status: DocumentStatus.DLQ, attempts: 3 }),
    );
    expect(rabbitMqService.ack).toHaveBeenCalled();
  });
});
