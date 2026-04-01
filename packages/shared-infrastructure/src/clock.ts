import { randomUUID } from 'node:crypto';

export class SystemClockAdapter {
  public now(): Date {
    return new Date();
  }
}

export class RandomIdGeneratorAdapter {
  public next(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}
