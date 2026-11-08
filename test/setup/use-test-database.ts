// Jest `setupFiles` entry, executed before every e2e test file. Points the
// application at the test database so `DATABASE_URL` (the demo database) can
// never be used by the Nest app under test.
import { loadLocalEnv, resolveTestDatabaseUrl } from './test-database';

loadLocalEnv();
process.env.DATABASE_URL = resolveTestDatabaseUrl();
