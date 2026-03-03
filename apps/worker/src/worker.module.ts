import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmModuleOptions, DocumentEntity } from '@app/db';
import { RabbitMqModule } from '@app/messaging';
import { WorkerConsumerService } from './worker.consumer';
import { WorkerHeartbeatService } from './worker.heartbeat';

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmModuleOptions()),
    TypeOrmModule.forFeature([DocumentEntity]),
    RabbitMqModule,
  ],
  providers: [WorkerConsumerService, WorkerHeartbeatService],
})
export class WorkerModule {}
