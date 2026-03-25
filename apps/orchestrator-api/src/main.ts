import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { OrchestratorApiModule } from './app.module';
import { buildOrchestratorProviderOverridesFromEnv } from './config/runtime.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(
    OrchestratorApiModule.register(buildOrchestratorProviderOverridesFromEnv())
  );
  await app.listen(3000);
}

void bootstrap();
