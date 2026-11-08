export interface Env {
  DATABASE_URL: string;
  PORT: number;
  DB_LOCK_TIMEOUT_MS: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_DB_LOCK_TIMEOUT_MS = 5000;
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

/** Error messages never echo values: DATABASE_URL carries credentials. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];

  const databaseUrl = readString(raw.DATABASE_URL);
  if (!databaseUrl || !isPostgresUrlWithDatabase(databaseUrl)) {
    errors.push(
      'DATABASE_URL must be a postgres:// or postgresql:// URL that includes a database name',
    );
  }

  const port = readInteger(raw.PORT, DEFAULT_PORT);
  if (port === null || port < 1 || port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
  }

  const lockTimeout = readInteger(
    raw.DB_LOCK_TIMEOUT_MS,
    DEFAULT_DB_LOCK_TIMEOUT_MS,
  );
  if (lockTimeout === null || lockTimeout < 1) {
    errors.push('DB_LOCK_TIMEOUT_MS must be a positive integer');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n- ${errors.join('\n- ')}`,
    );
  }

  return {
    DATABASE_URL: databaseUrl as string,
    PORT: port as number,
    DB_LOCK_TIMEOUT_MS: lockTimeout as number,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

function readInteger(value: unknown, fallback: number): number | null {
  const text = readString(value);
  if (text === undefined) return fallback;
  return /^\d+$/.test(text) ? Number(text) : null;
}

function isPostgresUrlWithDatabase(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      POSTGRES_PROTOCOLS.has(url.protocol) &&
      url.hostname !== '' &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}
