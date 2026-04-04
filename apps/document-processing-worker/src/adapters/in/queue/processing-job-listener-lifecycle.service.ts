import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TOKENS } from '../../../contracts/tokens';
import { ProcessingJobConsumer } from './processing-job.consumer';
import { RabbitMqProcessingJobListener } from './rabbitmq-processing-job-listener';

export type WorkerQueueListenerRuntime =
  | {
      mode: 'memory';
    }
  | {
      mode: 'real';
      rabbitMqUrl: string;
      queueName: string;
    };

export type ProcessingJobListenerPort = {
  start(): Promise<void>;
  close(): Promise<void>;
};

export type ProcessingJobListenerFactory = (
  consumer: ProcessingJobConsumer,
  options: {
    rabbitMqUrl: string;
    queueName: string;
  }
) => ProcessingJobListenerPort;

export const createRabbitMqProcessingJobListener: ProcessingJobListenerFactory = (consumer, options) =>
  new RabbitMqProcessingJobListener(options.rabbitMqUrl, options.queueName, consumer);

@Injectable()
export class ProcessingJobListenerLifecycleService implements OnModuleInit, OnModuleDestroy {
  private listener?: ProcessingJobListenerPort;

  public constructor(
    @Inject(TOKENS.QUEUE_LISTENER_RUNTIME) private readonly runtime: WorkerQueueListenerRuntime,
    @Inject(TOKENS.QUEUE_LISTENER_FACTORY) private readonly listenerFactory: ProcessingJobListenerFactory,
    private readonly consumer: ProcessingJobConsumer
  ) {}

  public async onModuleInit(): Promise<void> {
    if (this.runtime.mode !== 'real') {
      return;
    }

    this.listener = this.listenerFactory(this.consumer, {
      rabbitMqUrl: this.runtime.rabbitMqUrl,
      queueName: this.runtime.queueName
    });
    await this.listener.start();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.listener?.close();
    this.listener = undefined;
  }
}
