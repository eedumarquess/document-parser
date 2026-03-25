import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { connect } from 'amqplib';
import { RETRY_DELAYS_MS, type ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
import type { ProcessingJobConsumer } from './processing-job.consumer';

export class RabbitMqProcessingJobListener {
  private connection?: ChannelModel;
  private channel?: Channel;

  public constructor(
    private readonly url: string,
    private readonly queueName: string,
    private readonly consumer: ProcessingJobConsumer
  ) {}

  public async start(): Promise<void> {
    if (this.channel !== undefined) {
      return;
    }

    const connection = await connect(this.url);
    const channel = await connection.createChannel();
    await this.assertTopology(channel);
    await channel.prefetch(1);
    await channel.consume(this.queueName, (message) => {
      void this.handleMessage(message);
    });
    this.connection = connection;
    this.channel = channel;
  }

  public async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = undefined;
    this.connection = undefined;
  }

  private async handleMessage(message: ConsumeMessage | null): Promise<void> {
    if (message === null || this.channel === undefined) {
      return;
    }

    try {
      const payload = JSON.parse(message.content.toString('utf8')) as ProcessingJobRequestedMessage;
      await this.consumer.handle(payload);
      this.channel.ack(message);
    } catch {
      this.channel.nack(message, false, false);
    }
  }

  private async assertTopology(channel: Channel): Promise<void> {
    await channel.assertQueue(this.getDeadLetterQueueName(), { durable: true });
    await channel.assertQueue(this.queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': this.getDeadLetterQueueName()
      }
    });

    for (let index = 0; index < RETRY_DELAYS_MS.length; index += 1) {
      await channel.assertQueue(this.getRetryQueueName(index + 1), {
        durable: true,
        arguments: {
          'x-message-ttl': RETRY_DELAYS_MS[index],
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': this.queueName
        }
      });
    }
  }

  private getRetryQueueName(retryAttempt: number): string {
    return `${this.queueName}.retry.${retryAttempt}`;
  }

  private getDeadLetterQueueName(): string {
    return `${this.queueName}.dlq`;
  }
}
