import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmModuleOptions } from '@app/db';
import { RabbitMqModule } from '@app/messaging';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(getTypeOrmModuleOptions()),
    RabbitMqModule,
    DocumentsModule,
    HealthModule,
  ],
})
export class ApiModule {}
