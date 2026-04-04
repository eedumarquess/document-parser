import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentProcessingWorkerModule } from './app.module';
import { buildWorkerRuntimeBootstrapFromEnv } from './config/runtime.config';

async function bootstrap(): Promise<void> {
  const runtime = buildWorkerRuntimeBootstrapFromEnv();
  const app = await NestFactory.createApplicationContext(DocumentProcessingWorkerModule.register(runtime.overrides));
  app.enableShutdownHooks();
}

void bootstrap();
