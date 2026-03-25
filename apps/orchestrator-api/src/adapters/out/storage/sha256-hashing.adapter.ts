import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { HashingPort } from '../../../contracts/ports';

@Injectable()
export class Sha256HashingAdapter implements HashingPort {
  public async calculateHash(buffer: Buffer): Promise<string> {
    return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  }
}

