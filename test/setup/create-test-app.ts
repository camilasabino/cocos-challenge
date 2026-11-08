import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { assertConnectedToTestDatabase } from './test-database';

/** Boots the real app against the test database, verifying the live connection. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  try {
    await assertConnectedToTestDatabase(app.get(DataSource));
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}
