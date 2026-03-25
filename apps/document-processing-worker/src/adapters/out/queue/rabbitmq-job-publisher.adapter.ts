import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { connect } from 'amqplib';
import { TransientFailureError, type ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
import type { JobPublisherPort } from '../../../contracts/ports';

export class RabbitMqJobPublisherAdapter implements JobPublisherPort {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;

  public constructor(
    private readonly url: string,
    private readonly queueName: string
  ) {}

  public async publish(message: ProcessingJobRequestedMessage): Promise<void> {
    const channel = await this.getChannel();
    const payload = Buffer.from(JSON.stringify(message), 'utf8');

    await new Promise<void>((resolve, reject) => {
      channel.sendToQueue(
        this.queueName,
        payload,
        {
          persistent: true,
          contentType: 'application/json'
        },
        (error) => {
          if (error) {
            reject(new TransientFailureError('Failed to confirm RabbitMQ publication', { queueName: this.queueName }));
            return;
          }

          resolve();
        }
      );
    });
  }

  public async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = undefined;
    this.connection = undefined;
  }

  private async getChannel(): Promise<ConfirmChannel> {
    if (this.channel !== undefined) {
      return this.channel;
    }

    const connection = await connect(this.url);
    const channel = await connection.createConfirmChannel();
    await channel.assertQueue(this.queueName, { durable: true });
    this.connection = connection;
    this.channel = channel;
    return channel;
  }
}
