import { DataSource } from 'typeorm';
import { fixtureInstrumentId } from '../fixtures/instruments';

export interface TestOrder {
  /** Fixture ticker, or `ARS` for cash movements. */
  ticker: string;
  side: 'BUY' | 'SELL' | 'CASH_IN' | 'CASH_OUT';
  size: number;
  /** Decimal string; cash movements use `1.00`, like the demo data. */
  price: string;
  type?: 'MARKET' | 'LIMIT';
  status?: 'FILLED' | 'NEW' | 'REJECTED' | 'CANCELLED';
  /** UTC wall-clock time, e.g. `2026-11-03 11:00:00`. */
  datetime: string;
}

/** Inserts orders in the given order (ids follow the array, not `datetime`). */
export async function insertTestOrders(
  dataSource: DataSource,
  userId: number,
  orders: readonly TestOrder[],
  instrumentIdOf: (ticker: string) => number = fixtureInstrumentId,
): Promise<void> {
  for (const order of orders) {
    await dataSource.query(
      `INSERT INTO orders (instrumentid, userid, size, price, type, side, status, datetime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        instrumentIdOf(order.ticker),
        userId,
        order.size,
        order.price,
        order.type ?? 'MARKET',
        order.side,
        order.status ?? 'FILLED',
        order.datetime,
      ],
    );
  }
}
