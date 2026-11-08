import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

/**
 * Creates a brand-new user so each test owns its own data. Tests are isolated
 * by `userId` and must not depend on execution order or on other tests' rows.
 */
export async function createTestUser(dataSource: DataSource): Promise<number> {
  const token = randomUUID().replace(/-/g, '');
  const rows: { id: number }[] = await dataSource.query(
    'INSERT INTO users (email, accountnumber) VALUES ($1, $2) RETURNING id',
    [`user-${token}@test.example`, token.slice(0, 20)],
  );
  return rows[0].id;
}
