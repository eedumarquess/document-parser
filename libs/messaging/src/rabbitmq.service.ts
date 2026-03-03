import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  Channel,
  ChannelModel,
  ConsumeMessage,
  Message,
  Options,
  connect,
} from 'amqplib';
import {
  DOCUMENTS_DLQ_QUEUE,
  DOCUMENTS_DLQ_ROUTING_KEY,
  DOCUMENTS_EXCHANGE,
  DOCUMENTS_PROCESS_QUEUE,
  DOCUMENTS_PROCESS_ROUTING_KEY,
  DOCUMENTS_RETRY_QUEUE,
  DOCUMENTS_RETRY_ROUTING_KEY,
  RETRY_QUEUE_TTL_MS,
} from './messaging.constants';

type ConsumerHandler = (message: ConsumeMessage, payload: unknown) => Promise<void>;

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private connection: ChannelModel | null = null;
  private publishChannel: Channel | null = null;
  private consumerChannel: Channel | null = null;

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumerChannel?.close().catch(() => undefined);
    await this.publishChannel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  isHealthy(): boolean {
    return Boolean(this.connection && this.publishChannel && this.consumerChannel);
  }

  async publish(
    routingKey: string,
    payload: unknown,
    options: Options.Publish = {},
  ): Promise<void> {
    await this.ensureConnected();
    const body = Buffer.from(JSON.stringify(payload));
    this.publishChannel!.publish(DOCUMENTS_EXCHANGE, routingKey, body, {
      contentType: 'application/json',
      persistent: true,
      ...options,
    });
  }

  async consumeProcessQueue(handler: ConsumerHandler): Promise<void> {
    await this.ensureConnected();
    await this.consumerChannel!.prefetch(5);
    await this.consumerChannel!.consume(
      DOCUMENTS_PROCESS_QUEUE,
      async (message) => {
        if (!message) {
          return;
        }

        try {
          const payload = JSON.parse(message.content.toString('utf8'));
          await handler(message, payload);
        } catch (error) {
          this.consumerChannel!.ack(message);
          console.error(
            JSON.stringify({
              level: 'error',
              context: 'RabbitMqService',
              event: 'consume_failed',
              error: (error as Error).message,
            }),
          );
        }
      },
      { noAck: false },
    );
  }

  ack(message: Message): void {
    this.consumerChannel?.ack(message);
  }

  async connect(): Promise<void> {
    const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://localhost:5672';
    const maxAttempts = Number(process.env.RABBITMQ_CONNECT_RETRIES ?? 20);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const connection = await connect(rabbitUrl);
        connection.on('close', () => {
          this.connection = null;
          this.publishChannel = null;
          this.consumerChannel = null;
        });
        connection.on('error', () => {
          this.connection = null;
          this.publishChannel = null;
          this.consumerChannel = null;
        });
        this.connection = connection;
        this.publishChannel = await connection.createChannel();
        this.consumerChannel = await connection.createChannel();
        await this.assertTopology();
        return;
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connection || !this.publishChannel || !this.consumerChannel) {
      await this.connect();
    }
  }

  private async assertTopology(): Promise<void> {
    await this.publishChannel!.assertExchange(DOCUMENTS_EXCHANGE, 'direct', {
      durable: true,
    });

    await this.publishChannel!.assertQueue(DOCUMENTS_PROCESS_QUEUE, {
      durable: true,
    });
    await this.publishChannel!.bindQueue(
      DOCUMENTS_PROCESS_QUEUE,
      DOCUMENTS_EXCHANGE,
      DOCUMENTS_PROCESS_ROUTING_KEY,
    );

    await this.publishChannel!.assertQueue(DOCUMENTS_RETRY_QUEUE, {
      durable: true,
      deadLetterExchange: DOCUMENTS_EXCHANGE,
      deadLetterRoutingKey: DOCUMENTS_PROCESS_ROUTING_KEY,
      messageTtl: RETRY_QUEUE_TTL_MS,
    });
    await this.publishChannel!.bindQueue(
      DOCUMENTS_RETRY_QUEUE,
      DOCUMENTS_EXCHANGE,
      DOCUMENTS_RETRY_ROUTING_KEY,
    );

    await this.publishChannel!.assertQueue(DOCUMENTS_DLQ_QUEUE, {
      durable: true,
    });
    await this.publishChannel!.bindQueue(
      DOCUMENTS_DLQ_QUEUE,
      DOCUMENTS_EXCHANGE,
      DOCUMENTS_DLQ_ROUTING_KEY,
    );
  }
}
