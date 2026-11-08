import { Test } from '@nestjs/testing';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  INSTRUMENT_FIXTURES,
  fixtureInstrumentId,
} from './fixtures/instruments';
import { MARKET_DATA_FIXTURES } from './fixtures/market-data';
import { createTestUser } from './setup/create-test-user';
import { assertConnectedToTestDatabase } from './setup/test-database';

describe('application bootstrap against the test database', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('connects the application to cocos_test, never to the demo database', async () => {
    await expect(
      assertConnectedToTestDatabase(dataSource),
    ).resolves.toBeUndefined();
  });

  it('keeps TypeORM schema synchronization and automatic migrations disabled', () => {
    expect(dataSource.options.synchronize).toBe(false);
    expect(dataSource.options.migrationsRun).toBe(false);
  });

  it('has the provided schema, with lowercase physical column names', async () => {
    const rows: { name: string }[] = await dataSource.query(
      `SELECT table_name || '.' || column_name AS name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('orders', 'instrumentid'), ('orders', 'userid'),
            ('users', 'accountnumber'), ('marketdata', 'previousclose'))`,
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      'marketdata.previousclose',
      'orders.instrumentid',
      'orders.userid',
      'users.accountnumber',
    ]);
  });

  it('loads deterministic fixtures with stable ids', async () => {
    const instruments: { id: number; ticker: string; type: string }[] =
      await dataSource.query(
        'SELECT id, ticker, type FROM instruments ORDER BY id',
      );
    expect(instruments).toHaveLength(INSTRUMENT_FIXTURES.length);
    expect(instruments[0]).toEqual({ id: 1, ticker: 'ARS', type: 'MONEDA' });
    expect(fixtureInstrumentId('SIGM')).toBe(
      instruments.find((i) => i.ticker === 'SIGM')?.id,
    );

    const [{ count }]: { count: string }[] = await dataSource.query(
      'SELECT count(*) AS count FROM marketdata',
    );
    expect(Number(count)).toBe(MARKET_DATA_FIXTURES.length);

    const [{ withoutData }]: { withoutData: string }[] = await dataSource.query(
      `SELECT count(*) AS "withoutData" FROM instruments i
        WHERE i.type <> 'MONEDA'
          AND NOT EXISTS (SELECT 1 FROM marketdata m WHERE m.instrumentid = i.id)`,
    );
    expect(Number(withoutData)).toBe(1);
  });

  it('gives every test its own user', async () => {
    const [first, second] = [
      await createTestUser(dataSource),
      await createTestUser(dataSource),
    ];
    expect(first).not.toBe(second);
  });
});
