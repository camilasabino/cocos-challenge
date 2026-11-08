// Side-effect module: import it BEFORE anything that loads AppModule, since
// ConfigModule reads the environment on import. Jest isolates env per file.
export const SHORT_LOCK_TIMEOUT_MS = 300;
process.env.DB_LOCK_TIMEOUT_MS = String(SHORT_LOCK_TIMEOUT_MS);
