export interface Env {
  DATABASE_URL: string;
  PORT: number;
  DB_LOCK_TIMEOUT_MS: number;
  DB_POOL_MAX: number;
  DB_POOL_ACQUIRE_TIMEOUT_MS: number;
}

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

/** PostgreSQL `lock_timeout` is an int4 of milliseconds; 0 would disable it. */
const POSTGRES_MAX_TIMEOUT_MS = 2_147_483_647;

interface IntegerSetting {
  name: keyof Env;
  fallback: number;
  min: number;
  max: number;
}

const PORT: IntegerSetting = {
  name: 'PORT',
  fallback: 3000,
  min: 1,
  max: 65_535,
};

// Order placement is the only workflow that waits on a lock; it holds its
// connection while waiting, so the lock wait is also bounded by the pool.
const DB_LOCK_TIMEOUT_MS: IntegerSetting = {
  name: 'DB_LOCK_TIMEOUT_MS',
  fallback: 5_000,
  min: 1,
  max: POSTGRES_MAX_TIMEOUT_MS,
};

// Conservative for a single instance; PostgreSQL's default max_connections is
// 100 and hosted databases often allow far fewer.
const DB_POOL_MAX: IntegerSetting = {
  name: 'DB_POOL_MAX',
  fallback: 10,
  min: 1,
  max: 100,
};

const DB_POOL_ACQUIRE_TIMEOUT_MS: IntegerSetting = {
  name: 'DB_POOL_ACQUIRE_TIMEOUT_MS',
  fallback: 5_000,
  min: 1,
  max: 120_000,
};

/** Error messages never echo values: DATABASE_URL carries credentials. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];

  const databaseUrl = readString(raw.DATABASE_URL);
  if (!databaseUrl || !isPostgresUrlWithDatabase(databaseUrl)) {
    errors.push(
      'DATABASE_URL must be a postgres:// or postgresql:// URL that includes a database name',
    );
  }

  const integer = (setting: IntegerSetting): number => {
    const value = readInteger(raw[setting.name], setting.fallback);
    if (value === null || value < setting.min || value > setting.max) {
      errors.push(
        `${setting.name} must be an integer between ${setting.min} and ${setting.max}`,
      );
      return setting.fallback;
    }
    return value;
  };

  const env: Env = {
    DATABASE_URL: databaseUrl as string,
    PORT: integer(PORT),
    DB_LOCK_TIMEOUT_MS: integer(DB_LOCK_TIMEOUT_MS),
    DB_POOL_MAX: integer(DB_POOL_MAX),
    DB_POOL_ACQUIRE_TIMEOUT_MS: integer(DB_POOL_ACQUIRE_TIMEOUT_MS),
  };

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n- ${errors.join('\n- ')}`,
    );
  }
  return env;
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
