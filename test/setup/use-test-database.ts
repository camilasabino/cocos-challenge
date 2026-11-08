// Jest `setupFiles` entry: points the app at the test database so the demo
// `DATABASE_URL` can never be used by the app under test.
import { loadLocalEnv, resolveTestDatabaseUrl } from './test-database';

loadLocalEnv();
process.env.DATABASE_URL = resolveTestDatabaseUrl();
