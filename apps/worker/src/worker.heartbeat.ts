import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RabbitMqService } from '@app/messaging';
import { WorkerConsumerService } from './worker.consumer';

@Injectable()
export class WorkerHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly workerConsumerService: WorkerConsumerService,
    private readonly rabbitMqService: RabbitMqService,
  ) {}

  onModuleInit(): void {
    this.intervalId = setInterval(() => {
      const stats = this.workerConsumerService.getStats();
      console.log(
        JSON.stringify({
          level: 'info',
          context: 'WorkerHeartbeatService',
          event: 'worker_heartbeat',
          rabbitmqHealthy: this.rabbitMqService.isHealthy(),
          ...stats,
        }),
      );
    }, 30000);
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
