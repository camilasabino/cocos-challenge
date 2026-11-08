import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/create-test-app';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 200 with a minimal body while PostgreSQL is reachable', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('does not expose connection details in headers or body', async () => {
    const response = await request(app.getHttpServer() as Server).get(
      '/health',
    );

    const everything = JSON.stringify([response.body, response.headers]);
    expect(everything).not.toMatch(/postgres|cocos|localhost|password/i);
  });
});
