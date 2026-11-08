import { DataSource, QueryRunner } from 'typeorm';

/**
 * Holds the same row lock that order placement takes (`users` row, FOR UPDATE)
 * from an independent connection, so tests can create contention
 * deterministically instead of racing real requests.
 */
export class HeldUserLock {
  private constructor(private readonly runner: QueryRunner) {}

  static async acquire(
    dataSource: DataSource,
    userId: number,
  ): Promise<HeldUserLock> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');
    await runner.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
      userId,
    ]);
    return new HeldUserLock(runner);
  }

  async release(): Promise<void> {
    try {
      if (this.runner.isTransactionActive) {
        await this.runner.commitTransaction();
      }
    } finally {
      await this.runner.release();
    }
  }
}

/** Backends currently blocked waiting for a row lock taken by `SELECT … FOR UPDATE`. */
export async function countBackendsWaitingForUserLock(
  dataSource: DataSource,
): Promise<number> {
  const [{ count }] = await dataSource.query<{ count: string }[]>(
    `SELECT count(*) AS count
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%FROM users%FOR UPDATE%'`,
  );
  return Number(count);
}

/** Connections left inside an open transaction (a leak would show up here). */
export async function countIdleInTransaction(
  dataSource: DataSource,
): Promise<number> {
  const [{ count }] = await dataSource.query<{ count: string }[]>(
    `SELECT count(*) AS count
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state LIKE 'idle in transaction%'`,
  );
  return Number(count);
}

/** Polls `condition` until true; fails with `description` after `timeoutMs`. */
export async function waitUntil(
  condition: () => Promise<boolean>,
  description: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
