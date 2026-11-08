// Side-effect module: import it BEFORE anything that loads AppModule, since
// ConfigModule reads the environment on import. Jest isolates env per file.
export const SMALL_POOL_ACQUIRE_TIMEOUT_MS = 300;
process.env.DB_POOL_MAX = '1';
process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = String(SMALL_POOL_ACQUIRE_TIMEOUT_MS);
