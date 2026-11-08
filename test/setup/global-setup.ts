import { DataSource } from 'typeorm';
import { resetDatabaseWithFixtures } from './load-fixtures';
import { loadLocalEnv, resolveTestDatabaseUrl } from './test-database';

// Runs once per `npm run test:e2e`: resets the test database to its fixtures.
export default async function globalSetup(): Promise<void> {
  loadLocalEnv();
  const dataSource = new DataSource({
    type: 'postgres',
    url: resolveTestDatabaseUrl(),
  });
  await dataSource.initialize();
  try {
    await resetDatabaseWithFixtures(dataSource);
  } finally {
    await dataSource.destroy();
  }
}
