import { Injectable } from '@nestjs/common';
import { RabbitMqService } from '@app/messaging';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rabbitMqService: RabbitMqService,
  ) {}

  async check() {
    let postgres = false;
    try {
      await this.dataSource.query('SELECT 1');
      postgres = true;
    } catch {
      postgres = false;
    }

    const rabbitmq = this.rabbitMqService.isHealthy();
    return {
      status: postgres && rabbitmq ? 'ok' : 'error',
      postgres,
      rabbitmq,
      timestamp: new Date().toISOString(),
    };
  }
}
