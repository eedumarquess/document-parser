import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(@Res({ passthrough: true }) response: Response) {
    const health = await this.healthService.check();
    if (health.status !== 'ok') {
      response.status(503);
    }
    return health;
  }
}
