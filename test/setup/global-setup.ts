import { DataSource } from 'typeorm';
import { resetDatabaseWithFixtures } from './load-fixtures';
import { loadLocalEnv, resolveTestDatabaseUrl } from './test-database';

/**
 * Process time zone for every e2e run. It must not be UTC: a server running in
 * UTC would hide any code that mixes UTC wall-clock values with local time
 * (e.g. serializing a JS Date into a TIMESTAMP-without-zone column). Override
 * with TEST_TIMEZONE to re-run the suite under another zone.
 */
const DEFAULT_TEST_TIMEZONE = 'America/New_York';

// Runs once per `npm run test:e2e`: resets the test database to its fixtures.
export default async function globalSetup(): Promise<void> {
  loadLocalEnv();
  // Assigned here (not in a worker) so the real process, and every worker it
  // forks, uses it; Node re-reads TZ when process.env.TZ is assigned.
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
