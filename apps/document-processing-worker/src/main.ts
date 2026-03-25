import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentProcessingWorkerModule } from './app.module';
import { ProcessingJobConsumer } from './adapters/in/queue/processing-job.consumer';
import { RabbitMqProcessingJobListener } from './adapters/in/queue/rabbitmq-processing-job-listener';
import { buildWorkerRuntimeBootstrapFromEnv } from './config/runtime.config';

async function bootstrap(): Promise<void> {
  const runtime = buildWorkerRuntimeBootstrapFromEnv();
  const app = await NestFactory.createApplicationContext(
    DocumentProcessingWorkerModule.register(runtime.overrides)
  );

  if (runtime.mode !== 'real' || runtime.queueName === undefined || runtime.rabbitMqUrl === undefined) {
    return;
  }

  const listener = new RabbitMqProcessingJobListener(
    runtime.rabbitMqUrl,
    runtime.queueName,
    app.get(ProcessingJobConsumer)
  );
  await listener.start();

  const shutdown = async () => {
    await listener.close();
    await app.close();
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

void bootstrap();
