import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@document-parser/shared-kernel';
import { OrchestratorApiModule } from '../../src/app.module';

describe('Non-PDF upload validation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OrchestratorApiModule.register()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the existing MIME validation error instead of a native PDF failure', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/parsing/jobs')
      .set('x-role', Role.OWNER)
      .attach('file', Buffer.from('plain text upload'), {
        filename: 'sample.txt',
        contentType: 'text/plain'
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errorCode: 'VALIDATION_ERROR',
      message: 'Unsupported MIME type',
      metadata: {
        mimeType: 'text/plain'
      }
    });
  });
});
