import { DataSource } from 'typeorm';
import {
  INSTRUMENT_FIXTURES,
  fixtureInstrumentId,
} from '../fixtures/instruments';
import { MARKET_DATA_FIXTURES } from '../fixtures/market-data';
import { assertConnectedToTestDatabase } from './test-database';

export async function resetDatabaseWithFixtures(
  dataSource: DataSource,
): Promise<void> {
  await assertConnectedToTestDatabase(dataSource);

  await dataSource.transaction(async (manager) => {
    await manager.query(
      'TRUNCATE TABLE orders, marketdata, instruments, users RESTART IDENTITY CASCADE',
    );

    for (const instrument of INSTRUMENT_FIXTURES) {
      await manager.query(
        'INSERT INTO instruments (ticker, name, type) VALUES ($1, $2, $3)',
        [instrument.ticker, instrument.name, instrument.type],
      );
    }

    for (const row of MARKET_DATA_FIXTURES) {
      await manager.query(
        `INSERT INTO marketdata (instrumentid, open, high, low, close, previousclose, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          fixtureInstrumentId(row.ticker),
          row.open,
          row.high,
          row.low,
          row.close,
          row.previousClose,
          row.date,
        ],
      );
    }
  });
}
