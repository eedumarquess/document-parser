import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentProcessingWorkerModule } from './app.module';

async function bootstrap(): Promise<void> {
  await NestFactory.createApplicationContext(
    DocumentProcessingWorkerModule.register({
      storage: {
        async read(): Promise<Buffer> {
          return Buffer.alloc(0);
        }
      },
      publisher: {
        async publish(): Promise<void> {
          return;
        }
      }
    })
  );
}

void bootstrap();
