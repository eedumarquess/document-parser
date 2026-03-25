import type { AuditActor, ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';

export class FixedClock {
  public constructor(private readonly nowValue: Date = new Date('2026-03-25T12:00:00.000Z')) {}

  public now(): Date {
    return new Date(this.nowValue);
  }
}

export class IncrementalIdGenerator {
  private sequence = 0;

  public next(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}

export class InMemoryPublishedMessageBus {
  public readonly messages: ProcessingJobRequestedMessage[] = [];
  public readonly retryMessages: Array<{ message: ProcessingJobRequestedMessage; retryAttempt: number }> = [];

  public async publishRequested(message: ProcessingJobRequestedMessage): Promise<void> {
    this.messages.push(message);
  }

  public async publishRetry(message: ProcessingJobRequestedMessage, retryAttempt: number): Promise<void> {
    this.retryMessages.push({ message, retryAttempt });
    this.messages.push(message);
  }
}

export class InMemoryAuditTrail {
  public readonly entries: Array<{ eventType: string; actor: AuditActor; metadata?: Record<string, unknown> }> =
    [];

  public async record(
    eventType: string,
    actor: AuditActor,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.entries.push({ eventType, actor, metadata });
  }
}
