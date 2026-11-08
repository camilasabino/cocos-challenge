import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { fixtureInstrumentId } from './fixtures/instruments';
import { createTestApp } from './setup/create-test-app';
import { insertTestOrders } from './setup/create-test-orders';
import { createTestUser } from './setup/create-test-user';
import {
  OrderResponse,
  cashInOrder,
  getPortfolio,
  orderRowsOf,
  postOrder,
} from './setup/order-requests';

const ALFA = fixtureInstrumentId('ALFA');
/** Neither is UTC; Tokyo is ahead of UTC and the default process zone is behind it. */
const SESSION_TIME_ZONE = 'Asia/Tokyo';

/**
 * `orders.datetime` is a TIMESTAMP without time zone that the whole app reads
 * as UTC. These tests run with a process zone that is not UTC (see
 * global-setup.ts) and a PostgreSQL session `TimeZone` that is neither UTC nor
 * the process zone, so any implicit conversion shifts the stored value by
 * hours and is caught by comparing against the database's own UTC clock.
 */
describe('POST /orders timestamps (UTC, independent of process and session zones)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let previousPgOptions: string | undefined;

  beforeAll(async () => {
    previousPgOptions = process.env.PGOPTIONS;
    // libpq-style startup option honored by node-postgres: every pooled
    // connection of the app starts with this session TimeZone.
    process.env.PGOPTIONS = `-c TimeZone=${SESSION_TIME_ZONE}`;
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
    if (previousPgOptions === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = previousPgOptions;
  });

  it('is running under a non-UTC process zone and a non-UTC session zone', async () => {
    const processOffsets = [
      new Date(2026, 0, 15).getTimezoneOffset(),
      new Date(2026, 6, 15).getTimezoneOffset(),
    ];
    expect(processOffsets.some((offset) => offset !== 0)).toBe(true);

    const [{ TimeZone }] =
      await dataSource.query<{ TimeZone: string }[]>('SHOW TimeZone');
    expect(TimeZone).toBe(SESSION_TIME_ZONE);
  });

  async function placeFilledBuy(): Promise<{
    userId: number;
    order: OrderResponse;
  }> {
    const userId = await createTestUser(dataSource);
    await insertTestOrders(dataSource, userId, [cashInOrder(1000)]);
    const response = await postOrder(app, {
      userId,
      instrumentId: ALFA,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    }).expect(201);
    return { userId, order: response.body as OrderResponse };
  }

  it('stores the UTC wall clock, not local time', async () => {
    const { userId, order } = await placeFilledBuy();

    const [{ secondsFromUtcNow }] = await dataSource.query<
      { secondsFromUtcNow: string }[]
    >(
      `SELECT extract(epoch FROM ((now() AT TIME ZONE 'UTC') - datetime)) AS "secondsFromUtcNow"
         FROM orders WHERE id = $1`,
      [order.id],
    );

    // A zone leak would be hours (Tokyo +9h, New York -4/-5h), not seconds.
    expect(Number(secondsFromUtcNow)).toBeGreaterThanOrEqual(0);
    expect(Number(secondsFromUtcNow)).toBeLessThan(60);
    expect((await orderRowsOf(dataSource, userId)).at(-1)?.datetime).toBe(
      order.datetime,
    );
  });

  it('responds with the stored instant as ISO-8601 UTC', async () => {
    const { order } = await placeFilledBuy();

    const [{ nowUtc }] = await dataSource.query<{ nowUtc: string }[]>(
      `SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nowUtc"`,
    );

    expect(order.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    const skewMs = Math.abs(Date.parse(nowUtc) - Date.parse(order.datetime));
    expect(skewMs).toBeLessThan(60_000);
  });

  it('writes REJECTED and NEW orders with UTC timestamps too', async () => {
    const userId = await createTestUser(dataSource);
    const rejected = await postOrder(app, {
      userId,
      instrumentId: ALFA,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    }).expect(201);
    await insertTestOrders(dataSource, userId, [cashInOrder(1000)]);
    const accepted = await postOrder(app, {
      userId,
      instrumentId: ALFA,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '10.00',
    }).expect(201);

    const statuses = [rejected, accepted].map(
      (r) => (r.body as OrderResponse).status,
    );
    expect(statuses).toEqual(['REJECTED', 'NEW']);
    const rows = await dataSource.query<{ drift: string }[]>(
      `SELECT extract(epoch FROM ((now() AT TIME ZONE 'UTC') - datetime)) AS drift
         FROM orders WHERE userid = $1 AND side = 'BUY' ORDER BY id`,
      [userId],
    );
    for (const { drift } of rows.filter((_, i) => i !== 1)) {
      expect(Number(drift)).toBeGreaterThanOrEqual(0);
      expect(Number(drift)).toBeLessThan(60);
    }
  });

  it('keeps API-placed orders chronologically consistent with historical UTC rows (portfolio cost basis)', async () => {
    const userId = await createTestUser(dataSource);
    // Seed rows are UTC wall-clock values in the past, like the demo data.
    await insertTestOrders(dataSource, userId, [
      cashInOrder(10000),
      {
        ticker: 'ALFA',
        side: 'BUY',
        size: 10,
        price: '100.00',
        datetime: '2026-11-03 11:00:00',
      },
    ]);

    await postOrder(app, {
      userId,
      instrumentId: ALFA,
      side: 'BUY',
      type: 'MARKET',
      size: 10,
    }).expect(201); // 10 @ 105.00 now
    await postOrder(app, {
      userId,
      instrumentId: ALFA,
      side: 'SELL',
      type: 'MARKET',
      size: 5,
    }).expect(201);

    const portfolio = await getPortfolio(app, userId);
    // Average cost (100*10 + 105*10) / 20 = 102.50, unchanged by the sale.
    expect(portfolio.positions).toEqual([
      expect.objectContaining({ quantity: 15, averageCost: '102.50' }),
    ]);
  });
});
