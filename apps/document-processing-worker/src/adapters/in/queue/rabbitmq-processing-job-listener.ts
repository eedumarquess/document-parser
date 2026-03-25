import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { connect } from 'amqplib';
import type { ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
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
    await channel.assertQueue(this.queueName, { durable: true });
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
}
