// Side-effect module: import it BEFORE anything that loads AppModule.
// ConfigModule.forRoot() reads and validates the environment when AppModule is
// first imported (not when the app boots), so DB_LOCK_TIMEOUT_MS has to be in
// place by then. Only affects the importing test file (Jest isolates env).
export const SHORT_LOCK_TIMEOUT_MS = 300;
process.env.DB_LOCK_TIMEOUT_MS = String(SHORT_LOCK_TIMEOUT_MS);
