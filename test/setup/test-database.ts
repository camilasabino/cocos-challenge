import { DataSource } from 'typeorm';

export const TEST_DATABASE_NAME = 'cocos_test';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function loadLocalEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Test setup truncates tables, so only `cocos_test` on this machine is
 * accepted. Messages never echo the URL: it carries credentials.
 */
export function resolveTestDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.TEST_DATABASE_URL?.trim();
  if (!raw) {
    throw new Error(
      'TEST_DATABASE_URL is required for tests (see .env.example).',
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL.');
  }

  if (url.pathname !== `/${TEST_DATABASE_NAME}`) {
    throw new Error(
      `TEST_DATABASE_URL must point to the "${TEST_DATABASE_NAME}" database; refusing to run tests.`,
    );
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      'TEST_DATABASE_URL must point to a database on localhost; refusing to run tests.',
    );
  }
  return raw;
}

export async function assertConnectedToTestDatabase(
  dataSource: DataSource,
): Promise<void> {
  const rows: { name: string }[] = await dataSource.query(
    'SELECT current_database() AS name',
  );
  if (rows[0]?.name !== TEST_DATABASE_NAME) {
    throw new Error(
      `Connected to an unexpected database; tests only run against "${TEST_DATABASE_NAME}".`,
    );
  }
}
