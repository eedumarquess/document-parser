import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { OrchestratorApiModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(OrchestratorApiModule.register());
  await app.listen(3000);
}

void bootstrap();
