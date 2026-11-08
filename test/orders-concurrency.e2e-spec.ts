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
import {
  HeldUserLock,
  countBackendsWaitingForUserLock,
  waitUntil,
} from './setup/user-lock';

const ALFA = fixtureInstrumentId('ALFA'); // latest close 105.00

describe('POST /orders concurrency (per-user row lock, READ COMMITTED)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  /** The database's current UTC time at millisecond precision, like stored timestamps. */
  async function utcClockNow(): Promise<string> {
    const [{ now }] = await dataSource.query<{ now: string }[]>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`,
    );
    return now;
  }

  async function userWithCash(cash: number): Promise<number> {
    const userId = await createTestUser(dataSource);
    await insertTestOrders(dataSource, userId, [cashInOrder(cash)]);
    return userId;
  }

  const buy = (userId: number, size: number, side: 'BUY' | 'SELL' = 'BUY') =>
    postOrder(app, {
      userId,
      instrumentId: ALFA,
      side,
      type: 'MARKET',
      size,
    });

  const statuses = (responses: { body: unknown }[]) =>
    responses.map((r) => (r.body as OrderResponse).status).sort();

  it('two simultaneous BUYs that each need more than half the cash: exactly one fills', async () => {
    const userId = await userWithCash(1000);

    // 6 * 105.00 = 630.00 each: only one fits in 1000.00.
    const responses = await Promise.all([buy(userId, 6), buy(userId, 6)]);

    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(statuses(responses)).toEqual(['FILLED', 'REJECTED']);
    const rejected = responses
      .map((r) => r.body as OrderResponse)
      .find((order) => order.status === 'REJECTED');
    expect(rejected?.rejectionReason).toBe('INSUFFICIENT_FUNDS');

    expect(await orderRowsOf(dataSource, userId)).toHaveLength(3); // CASH_IN + 2
    const portfolio = await getPortfolio(app, userId);
    expect(portfolio.cashBalance).toBe('370.00');
    expect(Number(portfolio.cashBalance)).toBeGreaterThanOrEqual(0);
    expect(portfolio.positions).toEqual([
      expect.objectContaining({ quantity: 6 }),
    ]);
  });

  it('requests queued on the lock are serialized: balances never go negative and timestamps follow the lock order', async () => {
    const userId = await userWithCash(1000);
    const lock = await HeldUserLock.acquire(dataSource, userId);

    // Three BUYs of 420.00 each: only two fit in 1000.00. All of them first
    // block on the lock held below, so the outcome cannot depend on timing.
    let responses: { status: number; body: unknown }[];
    let releasedAt = '';
    try {
      const pending = Promise.all([
        buy(userId, 4),
        buy(userId, 4),
        buy(userId, 4),
      ]);
      await waitUntil(
        async () => (await countBackendsWaitingForUserLock(dataSource)) === 3,
        'three placements blocked on the user lock',
      );
      // Nothing was written while the lock is held.
      expect(await orderRowsOf(dataSource, userId)).toHaveLength(1);

      // The requests began their transactions before this instant; their rows
      // must be stamped after it (when they actually got the lock), not at
      // transaction start.
      releasedAt = await utcClockNow();
      await lock.release();
      responses = await pending;
    } finally {
      await lock.release().catch(() => undefined);
    }

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(statuses(responses)).toEqual(['FILLED', 'FILLED', 'REJECTED']);
    expect((await getPortfolio(app, userId)).cashBalance).toBe('160.00');

    const placed = (await orderRowsOf(dataSource, userId)).slice(1); // skip CASH_IN
    expect(placed.map((row) => row.status)).toEqual([
      'FILLED',
      'FILLED',
      'REJECTED',
    ]); // the rejection is whichever came last in the lock queue
    const times = placed.map((row) => Date.parse(row.datetime));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const row of placed) {
      expect(Date.parse(row.datetime)).toBeGreaterThanOrEqual(
        Date.parse(releasedAt),
      );
    }
  });

  it('a BUY and a SELL of the same user cannot both rely on the same stale balance', async () => {
    const userId = await userWithCash(1000);
    await insertTestOrders(dataSource, userId, [
      {
        ticker: 'ALFA',
        side: 'BUY',
        size: 5,
        price: '100.00',
        datetime: '2026-11-03 11:00:00',
      },
    ]); // cash 500.00, 5 shares
    const lock = await HeldUserLock.acquire(dataSource, userId);

    let responses: { body: unknown }[];
    try {
      const pending = Promise.all([
        buy(userId, 5, 'SELL'), // frees 525.00 once it executes
        buy(userId, 9), // 945.00: affordable only after the sale
      ]);
      await waitUntil(
        async () => (await countBackendsWaitingForUserLock(dataSource)) === 2,
        'two placements blocked on the user lock',
      );
      await lock.release();
      responses = await pending;
    } finally {
      await lock.release().catch(() => undefined);
    }

    // Whatever the queue order, the final state must be consistent with it.
    const portfolio = await getPortfolio(app, userId);
    const [first, second] = (await orderRowsOf(dataSource, userId)).slice(2);
    if (first.side === 'SELL') {
      expect([first.status, second.status]).toEqual(['FILLED', 'FILLED']);
      expect(portfolio.cashBalance).toBe('80.00'); // 500 + 525 - 945
    } else {
      expect([first.status, second.status]).toEqual(['REJECTED', 'FILLED']);
      expect(portfolio.cashBalance).toBe('1025.00'); // 500 + 525
    }
    expect(Number(portfolio.cashBalance)).toBeGreaterThanOrEqual(0);
    expect(responses).toHaveLength(2);
  });

  it('only the same user is serialized: another user is not blocked', async () => {
    const blockedUser = await userWithCash(1000);
    const otherUser = await userWithCash(1000);
    const lock = await HeldUserLock.acquire(dataSource, blockedUser);

    try {
      const blocked = buy(blockedUser, 1).then((r) => r);
      await waitUntil(
        async () => (await countBackendsWaitingForUserLock(dataSource)) === 1,
        'the placement blocked on the user lock',
      );

      const free = await buy(otherUser, 1).expect(201);
      expect((free.body as OrderResponse).status).toBe('FILLED');

      await lock.release();
      expect((await blocked).status).toBe(201);
    } finally {
      await lock.release().catch(() => undefined);
    }
  });
});
