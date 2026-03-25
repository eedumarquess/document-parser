import { Injectable } from '@nestjs/common';
import type { ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
import type { JobPublisherPort } from '../../../contracts/ports';

@Injectable()
export class InMemoryJobPublisherAdapter implements JobPublisherPort {
  public readonly messages: ProcessingJobRequestedMessage[] = [];
  private readonly subscribers: Array<(message: ProcessingJobRequestedMessage) => Promise<void>> = [];

  public async publish(message: ProcessingJobRequestedMessage): Promise<void> {
    this.messages.push(message);
    for (const subscriber of this.subscribers) {
      queueMicrotask(() => {
        void subscriber(message);
      });
    }
  }

  public subscribe(subscriber: (message: ProcessingJobRequestedMessage) => Promise<void>): void {
    this.subscribers.push(subscriber);
  }
}
