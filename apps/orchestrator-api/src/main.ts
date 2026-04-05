import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { OrchestratorApiModule } from './app.module';
import { buildOrchestratorRuntimeBootstrapFromEnv } from './config/runtime.config';
import { configureOrchestratorHttpApp } from './http-app.config';

async function bootstrap(): Promise<void> {
  const runtime = buildOrchestratorRuntimeBootstrapFromEnv();
  const app = await NestFactory.create(OrchestratorApiModule.register(runtime.overrides));
  configureOrchestratorHttpApp(app);
  app.enableShutdownHooks();
  await app.listen(3000);
}

void bootstrap();
