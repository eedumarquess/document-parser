import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureOrchestratorHttpApp(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Document Parser API')
      .setDescription(
        'HTTP API for document submission, status, results, advanced operations and local DX helpers.'
      )
      .setVersion('1.0.0')
      .addTag('Jobs')
      .addTag('Results')
      .addTag('Operations')
      .addTag('Dead Letters')
      .addTag('System')
      .build()
  );

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json'
  });
}
