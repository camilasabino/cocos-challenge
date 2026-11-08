import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { assertConnectedToTestDatabase } from './test-database';

/**
 * Boots the real application (same modules, validation and error handling as
 * production) against the test database. `setupFiles` has already pointed
 * DATABASE_URL at TEST_DATABASE_URL; the live connection is verified again here
 * before any test can issue a request.
 */
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
