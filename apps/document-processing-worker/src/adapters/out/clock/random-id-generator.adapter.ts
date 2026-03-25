import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IdGeneratorPort } from '../../../contracts/ports';

@Injectable()
export class RandomIdGeneratorAdapter implements IdGeneratorPort {
  public next(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}

