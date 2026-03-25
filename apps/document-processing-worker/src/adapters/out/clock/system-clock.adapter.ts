import { Injectable } from '@nestjs/common';
import type { ClockPort } from '../../../contracts/ports';

@Injectable()
export class SystemClockAdapter implements ClockPort {
  public now(): Date {
    return new Date();
  }
}

