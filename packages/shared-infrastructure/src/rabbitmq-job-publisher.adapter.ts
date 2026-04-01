import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { connect } from 'amqplib';
import {
  RETRY_DELAYS_MS,
  TransientFailureError,
  type ProcessingJobRequestedMessage
} from '@document-parser/shared-kernel';

export class RabbitMqJobPublisherAdapter {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;

  public constructor(
    private readonly url: string,
    private readonly queueName: string
  ) {}

  public async publishRequested(message: ProcessingJobRequestedMessage): Promise<void> {
    await this.publishToQueue(this.queueName, message);
  }

  public async publishRetry(message: ProcessingJobRequestedMessage, retryAttempt: number): Promise<void> {
    await this.publishToQueue(this.getRetryQueueName(retryAttempt), message);
  }

  private async publishToQueue(queueName: string, message: ProcessingJobRequestedMessage): Promise<void> {
    const channel = await this.getChannel();
    const payload = Buffer.from(JSON.stringify(message), 'utf8');

    await new Promise<void>((resolve, reject) => {
      channel.sendToQueue(
        queueName,
        payload,
        {
          persistent: true,
          contentType: 'application/json'
        },
        (error) => {
          if (error) {
            reject(new TransientFailureError('Failed to confirm RabbitMQ publication', { queueName }));
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
    await this.assertTopology(channel);
    this.connection = connection;
    this.channel = channel;
    return channel;
  }

  private async assertTopology(channel: ConfirmChannel): Promise<void> {
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
