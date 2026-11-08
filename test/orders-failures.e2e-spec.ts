import { SHORT_LOCK_TIMEOUT_MS } from './setup/short-lock-timeout'; // must stay the first import
import { INestApplication, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { fixtureInstrumentId } from './fixtures/instruments';
import { TradingRepository } from '../src/trading/persistence/trading.repository';
import { createTestApp } from './setup/create-test-app';
import { insertTestOrders } from './setup/create-test-orders';
import { createTestUser } from './setup/create-test-user';
import {
  cashInOrder,
  countAllOrders,
  orderRowsOf,
  postOrder,
} from './setup/order-requests';
import { HeldUserLock, countIdleInTransaction } from './setup/user-lock';

const ALFA = fixtureInstrumentId('ALFA');
const LOCK_TIMEOUT_MS = SHORT_LOCK_TIMEOUT_MS;

describe('POST /orders failure handling and rollback', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function userWithCash(cash: number): Promise<number> {
    const userId = await createTestUser(dataSource);
    await insertTestOrders(dataSource, userId, [cashInOrder(cash)]);
    return userId;
  }

  const buy = (userId: number, size = 1) =>
    postOrder(app, {
      userId,
      instrumentId: ALFA,
      side: 'BUY',
      type: 'MARKET',
      size,
    });

  /** The lock is free iff an immediate (NOWAIT) attempt succeeds. */
  async function expectUserLockFree(userId: number): Promise<void> {
    await dataSource.transaction(async (manager) => {
      await expect(
        manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE NOWAIT', [
          userId,
        ]),
      ).resolves.toHaveLength(1);
    });
  }

  describe('lock timeout', () => {
    it('answers 503 SERVICE_UNAVAILABLE without persisting or leaking details, then recovers', async () => {
      const userId = await userWithCash(1000);
      const before = await orderRowsOf(dataSource, userId);
      const lock = await HeldUserLock.acquire(dataSource, userId);

      let response: Awaited<ReturnType<typeof buy>>;
      const startedAt = Date.now();
      try {
        response = await buy(userId);
      } finally {
        await lock.release();
      }
      const waited = Date.now() - startedAt;

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: expect.any(String) as string,
      });
      const text = JSON.stringify(response.body).toLowerCase();
      expect(text).not.toMatch(/55p03|lock timeout|postgres|query|relation/);
      // It really waited for the configured timeout before giving up.
      expect(waited).toBeGreaterThanOrEqual(LOCK_TIMEOUT_MS - 50);
      expect(waited).toBeLessThan(LOCK_TIMEOUT_MS + 3000);
      expect(await orderRowsOf(dataSource, userId)).toEqual(before);

      // The failed attempt left nothing behind: the next request just works.
      await buy(userId).expect(201);
      expect(await countIdleInTransaction(dataSource)).toBe(0);
    });
  });

  describe('rollback', () => {
    it.each([
      [
        'ZERO_QUANTITY',
        {
          type: 'MARKET',
          amount: '10.00',
        },
        422,
      ],
      [
        'QUANTITY_OUT_OF_RANGE',
        { type: 'LIMIT', amount: '99999999.99', price: '0.01' },
        422,
      ],
      ['PRICE_UNAVAILABLE', { type: 'MARKET', size: 1, forNodt: true }, 422],
    ])(
      'a %s failure after the lock was taken releases it and persists nothing',
      async (_code, extra, status) => {
        const userId = await userWithCash(1000);
        const before = await orderRowsOf(dataSource, userId);
        const { forNodt, ...rest } = extra as Record<string, unknown>;

        await postOrder(app, {
          userId,
          instrumentId: forNodt ? fixtureInstrumentId('NODT') : ALFA,
          side: 'BUY',
          ...rest,
        }).expect(status);

        expect(await orderRowsOf(dataSource, userId)).toEqual(before);
        await expectUserLockFree(userId);
        expect(await countIdleInTransaction(dataSource)).toBe(0);
      },
    );

    it('an unknown user fails after the lock query, leaving no transaction open', async () => {
      const before = await countAllOrders(dataSource);

      await postOrder(app, {
        userId: 2147483647,
        instrumentId: ALFA,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      }).expect(404);

      expect(await countAllOrders(dataSource)).toBe(before);
      expect(await countIdleInTransaction(dataSource)).toBe(0);
    });

    it('an error after the INSERT rolls the order back (500, nothing persisted, lock released)', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const userId = await userWithCash(1000);
      const before = await orderRowsOf(dataSource, userId);

      // Called with the right `this` below, so the unbound reference is safe.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const realInsert = TradingRepository.prototype.insertOrder;
      const insert = jest
        .spyOn(TradingRepository.prototype, 'insertOrder')
        .mockImplementationOnce(async function (
          this: TradingRepository,
          ...args
        ) {
          await realInsert.apply(this, args); // the row really is inserted...
          throw new Error('simulated failure after insert'); // ...then the request fails
        });

      const response = await buy(userId).expect(500);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(response.body).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
      expect(await orderRowsOf(dataSource, userId)).toEqual(before);
      await expectUserLockFree(userId);
      expect(await countIdleInTransaction(dataSource)).toBe(0);

      // And the very next request is unaffected (the spy only failed once).
      await buy(userId).expect(201);
    });

    it('a REJECTED order is not an error: it is committed', async () => {
      const userId = await userWithCash(100);

      await buy(userId, 10).expect(201); // 1050.00 > 100.00

      expect(
        (await orderRowsOf(dataSource, userId)).map((row) => row.status),
      ).toEqual(['FILLED', 'REJECTED']);
    });

    it('a corrupt balance-affecting row fails the request generically and persists nothing', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const userId = await userWithCash(1000);
      // The schema allows a FILLED order without size; the ledger must refuse it.
      await dataSource.query(
        `INSERT INTO orders (instrumentid, userid, size, price, type, side, status, datetime)
         VALUES ($1, $2, NULL, '1.00', 'MARKET', 'BUY', 'FILLED', '2026-11-03 10:00:00')`,
        [ALFA, userId],
      );
      const before = await orderRowsOf(dataSource, userId);

      const response = await buy(userId).expect(500);

      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(await orderRowsOf(dataSource, userId)).toEqual(before);
      await expectUserLockFree(userId);
    });
  });
});
