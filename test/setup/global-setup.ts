import { DataSource } from 'typeorm';
import { resetDatabaseWithFixtures } from './load-fixtures';
import { loadLocalEnv, resolveTestDatabaseUrl } from './test-database';

/**
 * Must not be UTC: a UTC server would hide code that mixes UTC wall-clock
 * values with local time. Override with TEST_TIMEZONE.
 */
const DEFAULT_TEST_TIMEZONE = 'America/New_York';

export default async function globalSetup(): Promise<void> {
  loadLocalEnv();
  // Assigned here so every forked worker inherits it.
  process.env.TZ = process.env.TEST_TIMEZONE?.trim() || DEFAULT_TEST_TIMEZONE;

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
