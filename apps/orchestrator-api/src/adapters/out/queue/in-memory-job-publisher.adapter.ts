import { Injectable } from '@nestjs/common';
import type { ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
import type { JobPublisherPort } from '../../../contracts/ports';

@Injectable()
export class InMemoryJobPublisherAdapter implements JobPublisherPort {
  public readonly messages: ProcessingJobRequestedMessage[] = [];
  public readonly retryMessages: Array<{ message: ProcessingJobRequestedMessage; retryAttempt: number }> = [];
  private readonly subscribers: Array<(message: ProcessingJobRequestedMessage) => Promise<void>> = [];

  public async publishRequested(message: ProcessingJobRequestedMessage): Promise<void> {
    this.messages.push(message);
    for (const subscriber of this.subscribers) {
      queueMicrotask(() => {
        void subscriber(message);
      });
    }
  }

  public async publishRetry(message: ProcessingJobRequestedMessage, retryAttempt: number): Promise<void> {
    this.retryMessages.push({ message, retryAttempt });
    await this.publishRequested(message);
  }

  public subscribe(subscriber: (message: ProcessingJobRequestedMessage) => Promise<void>): void {
    this.subscribers.push(subscriber);
  }
}
