import type { ProcessingJobConsumer } from '../../src/adapters/in/queue/processing-job.consumer';
import {
  ProcessingJobListenerLifecycleService,
  type ProcessingJobListenerFactory
} from '../../src/adapters/in/queue/processing-job-listener-lifecycle.service';

describe('ProcessingJobListenerLifecycleService', () => {
  it('starts and closes a queue listener in real runtime mode', async () => {
    const listener = {
      start: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined)
    };
    const listenerFactory: ProcessingJobListenerFactory = jest.fn(() => listener);
    const consumer = {
      handle: jest.fn()
    } as unknown as ProcessingJobConsumer;
    const service = new ProcessingJobListenerLifecycleService(
      {
        mode: 'real',
        rabbitMqUrl: 'amqp://guest:guest@localhost:5672',
        queueName: 'document-processing.requested'
      },
      listenerFactory,
      consumer
    );

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(listenerFactory).toHaveBeenCalledWith(consumer, {
      rabbitMqUrl: 'amqp://guest:guest@localhost:5672',
      queueName: 'document-processing.requested'
    });
    expect(listener.start).toHaveBeenCalledTimes(1);
    expect(listener.close).toHaveBeenCalledTimes(1);
  });

  it('skips listener startup in memory mode', async () => {
    const listenerFactory: ProcessingJobListenerFactory = jest.fn();
    const service = new ProcessingJobListenerLifecycleService(
      {
        mode: 'memory'
      },
      listenerFactory,
      { handle: jest.fn() } as unknown as ProcessingJobConsumer
    );

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(listenerFactory).not.toHaveBeenCalled();
  });
});
