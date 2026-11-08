import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type {
  PortfolioResponse,
  PositionResponse,
} from '../src/trading/portfolio.response';
import { fixtureInstrumentId } from './fixtures/instruments';
import { createTestApp } from './setup/create-test-app';
import { TestOrder, insertTestOrders } from './setup/create-test-orders';
import { createTestUser } from './setup/create-test-user';

/**
 * Extra instruments for price edge cases the shared fixtures do not cover.
 * They are created here and removed afterwards, so other suites never see them.
 * Rows are listed in insertion order (ids ascend), which is what the
 * "latest price" scenarios depend on.
 */
const EXTRA_INSTRUMENTS: readonly {
  ticker: string;
  rows: readonly {
    date: string;
    close: string | null;
    previousClose: string | null;
  }[];
}[] = [
  {
    // The older row has the HIGHER id: the latest date must win over the id.
    ticker: 'XDTE',
    rows: [
      { date: '2026-11-06', close: '20.00', previousClose: '19.00' },
      { date: '2026-11-05', close: '99.00', previousClose: '98.00' },
    ],
  },
  {
    // The latest row (lower id) has no close; the older row must NOT be used instead.
    ticker: 'XNCL',
    rows: [
      { date: '2026-11-06', close: null, previousClose: '5.00' },
      { date: '2026-11-05', close: '5.00', previousClose: '4.00' },
    ],
  },
  {
    ticker: 'XPZR',
    rows: [{ date: '2026-11-06', close: '10.00', previousClose: '0.00' }],
  },
  {
    ticker: 'XPNL',
    rows: [{ date: '2026-11-06', close: '10.00', previousClose: null }],
  },
];

const MONEY = /^-?\d+\.\d{2}$/;

describe('GET /users/:userId/portfolio', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const extraIds = new Map<string, number>();

  const idOf = (ticker: string): number =>
    extraIds.get(ticker) ?? fixtureInstrumentId(ticker);

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);

    for (const { ticker, rows } of EXTRA_INSTRUMENTS) {
      const [{ id }] = await dataSource.query<{ id: number }[]>(
        `INSERT INTO instruments (ticker, name, type) VALUES ($1, $2, 'ACCIONES') RETURNING id`,
        [ticker, `Portfolio test ${ticker}`],
      );
      extraIds.set(ticker, id);
      for (const row of rows) {
        await dataSource.query(
          `INSERT INTO marketdata (instrumentid, close, previousclose, date) VALUES ($1, $2, $3, $4)`,
          [id, row.close, row.previousClose, row.date],
        );
      }
    }
  });

  afterAll(async () => {
    const ids = [...extraIds.values()];
    await dataSource.query('DELETE FROM orders WHERE instrumentid = ANY($1)', [
      ids,
    ]);
    await dataSource.query(
      'DELETE FROM marketdata WHERE instrumentid = ANY($1)',
      [ids],
    );
    await dataSource.query('DELETE FROM instruments WHERE id = ANY($1)', [ids]);
    await app.close();
  });

  const get = (userId: number | string) =>
    request(app.getHttpServer() as Server).get(`/users/${userId}/portfolio`);

  async function portfolioOf(userId: number): Promise<PortfolioResponse> {
    const response = await get(userId).expect(200);
    return response.body as PortfolioResponse;
  }

  /** A user with the given orders (inserted in array order). */
  async function userWith(orders: readonly TestOrder[]): Promise<number> {
    const userId = await createTestUser(dataSource);
    await insertTestOrders(dataSource, userId, orders, idOf);
    return userId;
  }

  const cashIn = (
    size: number,
    datetime = '2026-11-02 10:00:00',
  ): TestOrder => ({
    ticker: 'ARS',
    side: 'CASH_IN',
    size,
    price: '1.00',
    datetime,
  });

  const filled = (
    side: 'BUY' | 'SELL',
    ticker: string,
    size: number,
    price: string,
    datetime: string,
  ): TestOrder => ({ ticker, side, size, price, datetime });

  const limit = (
    side: 'BUY' | 'SELL',
    ticker: string,
    size: number,
    price: string,
    status: 'NEW' | 'REJECTED' | 'CANCELLED',
  ): TestOrder => ({
    ticker,
    side,
    size,
    price,
    type: 'LIMIT',
    status,
    datetime: '2026-11-06 10:00:00',
  });

  const position = (
    body: PortfolioResponse,
    ticker: string,
  ): PositionResponse => {
    const found = body.positions.find((p) => p.ticker === ticker);
    if (!found) throw new Error(`No position for ${ticker}`);
    return found;
  };

  describe('empty account', () => {
    it('returns zero cash, no positions and a complete zero valuation', async () => {
      const userId = await createTestUser(dataSource);

      const response = await get(userId).expect(200);

      expect(response.body).toEqual({
        userId,
        totalAccountValue: '0.00',
        cashBalance: '0.00',
        availableCash: '0.00',
        valuationComplete: true,
        unpricedInstrumentIds: [],
        positions: [],
      });
    });

    it('values cash deposits and withdrawals', async () => {
      const userId = await userWith([
        cashIn(100000),
        {
          ticker: 'ARS',
          side: 'CASH_OUT',
          size: 25000,
          price: '1.00',
          datetime: '2026-11-03 10:00:00',
        },
      ]);

      const body = await portfolioOf(userId);

      expect(body).toMatchObject({
        totalAccountValue: '75000.00',
        cashBalance: '75000.00',
        availableCash: '75000.00',
        positions: [],
      });
    });
  });

  describe('positions', () => {
    // Rows are inserted out of chronological order on purpose: the sale gets a
    // lower id than the purchases it depends on, so only `datetime` can order them.
    let userId: number;
    let body: PortfolioResponse;

    beforeAll(async () => {
      userId = await userWith([
        filled('SELL', 'ALFA', 60, '110.00', '2026-11-04 10:00:00'),
        cashIn(1000000),
        filled('BUY', 'ALFA', 100, '100.00', '2026-11-03 10:00:00'),
        filled('BUY', 'ALFA', 50, '104.00', '2026-11-03 11:00:00'),
        filled('BUY', 'GAMA', 1000, '10.00', '2026-11-03 12:00:00'),
        // Opened and fully closed: must not be listed.
        filled('BUY', 'DELT', 10, '20.00', '2026-11-03 13:00:00'),
        filled('SELL', 'DELT', 10, '21.00', '2026-11-04 11:00:00'),
        {
          ticker: 'ARS',
          side: 'CASH_OUT',
          size: 50000,
          price: '1.00',
          datetime: '2026-11-05 09:00:00',
        },
      ]);
      body = await portfolioOf(userId);
    });

    it('computes cash from deposits, withdrawals, purchases and sales', () => {
      // 1,000,000 - 10,000 - 5,200 + 6,600 - 10,000 - 200 + 210 - 50,000
      expect(body.cashBalance).toBe('931410.00');
      expect(body.availableCash).toBe('931410.00');
    });

    it('lists only open positions, ordered by ticker', () => {
      expect(body.positions.map((p) => p.ticker)).toEqual(['ALFA', 'GAMA']);
    });

    it('keeps the average cost after a partial sale and reports unrealized return', () => {
      // Cost basis: 100*100 + 50*104 = 15,200 for 150 shares; selling 60 leaves
      // 90 shares at the same average (101.3333...), basis 9,120.
      expect(position(body, 'ALFA')).toEqual({
        instrumentId: fixtureInstrumentId('ALFA'),
        ticker: 'ALFA',
        name: 'Alfa Energía S.A.',
        quantity: 90,
        lastPrice: '105.00',
        marketValue: '9450.00',
        averageCost: '101.33',
        totalReturnPercent: '3.62', // (9450 - 9120) / 9120
        dailyPriceChangePercent: '2.94', // (105 - 102) / 102
      });
      expect(position(body, 'GAMA')).toEqual({
        instrumentId: fixtureInstrumentId('GAMA'),
        ticker: 'GAMA',
        name: 'Gama 100% Verde S.A.',
        quantity: 1000,
        lastPrice: '11.00',
        marketValue: '11000.00',
        averageCost: '10.00',
        totalReturnPercent: '10.00',
        dailyPriceChangePercent: '4.76', // 0.50 / 10.50
      });
    });

    it('adds cash and position values into the total account value', () => {
      expect(body.totalAccountValue).toBe('951860.00'); // 931,410 + 9,450 + 11,000
      expect(body.valuationComplete).toBe(true);
      expect(body.unpricedInstrumentIds).toEqual([]);
    });

    it('serializes money and percentages as 2-decimal strings and quantity as an integer', () => {
      const strings = [
        body.totalAccountValue,
        body.cashBalance,
        body.availableCash,
        ...body.positions.flatMap((p) => [
          p.lastPrice,
          p.marketValue,
          p.averageCost,
          p.totalReturnPercent,
          p.dailyPriceChangePercent,
        ]),
      ];
      for (const value of strings) {
        expect(typeof value).toBe('string');
        expect(value).toMatch(MONEY);
      }
      for (const p of body.positions) {
        expect(Number.isInteger(p.quantity)).toBe(true);
      }
    });
  });

  describe('NEW orders', () => {
    it('reserve cash for availableCash only, leaving positions and the total untouched', async () => {
      const userId = await userWith([
        cashIn(100000),
        filled('BUY', 'ALFA', 100, '100.00', '2026-11-03 10:00:00'),
        limit('BUY', 'ALFAB', 200, '50.00', 'NEW'), // reserves 10,000
        limit('BUY', 'ALFA', 10, '90.00', 'NEW'), // reserves 900
        limit('SELL', 'ALFA', 40, '200.00', 'NEW'), // reserves shares, not cash
        // Not part of the ledger at all.
        limit('BUY', 'GAMA', 1000, '10.00', 'REJECTED'),
        limit('SELL', 'ALFA', 100, '100.00', 'CANCELLED'),
      ]);

      const body = await portfolioOf(userId);

      expect(body.cashBalance).toBe('90000.00');
      expect(body.availableCash).toBe('79100.00'); // 90,000 - 10,900
      expect(body.totalAccountValue).toBe('100500.00'); // 90,000 + 100 * 105
      expect(body.positions).toHaveLength(1);
      expect(body.positions[0]).toMatchObject({
        ticker: 'ALFA',
        quantity: 100,
        marketValue: '10500.00',
        averageCost: '100.00',
        totalReturnPercent: '5.00',
      });
    });
  });

  describe('latest market data', () => {
    it('breaks same-date ties with the highest marketdata id', async () => {
      // SIGM has two rows on 2026-11-06 (close 708.00, then 710.50).
      const userId = await userWith([
        cashIn(100000),
        filled('BUY', 'SIGM', 10, '700.00', '2026-11-03 10:00:00'),
      ]);

      const body = await portfolioOf(userId);

      expect(position(body, 'SIGM')).toMatchObject({
        lastPrice: '710.50',
        marketValue: '7105.00',
        averageCost: '700.00',
        totalReturnPercent: '1.50',
        dailyPriceChangePercent: '0.78', // (710.50 - 705) / 705
      });
      expect(body.totalAccountValue).toBe('100105.00'); // 93,000 + 7,105
    });

    it('prefers the most recent date over a higher id', async () => {
      const userId = await userWith([
        cashIn(100000),
        filled('BUY', 'XDTE', 10, '19.00', '2026-11-03 10:00:00'),
      ]);

      const body = await portfolioOf(userId);

      expect(position(body, 'XDTE')).toMatchObject({
        lastPrice: '20.00',
        marketValue: '200.00',
        dailyPriceChangePercent: '5.26', // (20 - 19) / 19
      });
    });

    it('derives the daily price change from close and previousclose', async () => {
      const userId = await userWith([
        filled('BUY', 'ALFA', 1, '1.00', '2026-11-03 10:00:00'),
        filled('BUY', 'ALFAB', 1, '1.00', '2026-11-03 10:01:00'),
        filled('BUY', 'BETA', 1, '1.00', '2026-11-03 10:02:00'),
        filled('BUY', 'DELT', 1, '1.00', '2026-11-03 10:03:00'),
        filled('BUY', 'XPZR', 1, '1.00', '2026-11-03 10:04:00'),
        filled('BUY', 'XPNL', 1, '1.00', '2026-11-03 10:05:00'),
      ]);

      const body = await portfolioOf(userId);

      const quotes: Record<string, (string | null)[]> = {};
      for (const p of body.positions) {
        quotes[p.ticker as string] = [p.lastPrice, p.dailyPriceChangePercent];
      }
      expect(quotes).toEqual({
        ALFA: ['105.00', '2.94'], // 102 -> 105
        ALFAB: ['49.50', '-2.94'], // 51 -> 49.50
        BETA: ['300.00', '0.00'], // unchanged
        DELT: ['20.25', '1.25'], // 20 -> 20.25
        XPZR: ['10.00', null], // previousclose 0
        XPNL: ['10.00', null], // previousclose NULL
      });
    });
  });

  describe('missing prices', () => {
    it('returns no total and flags the instrument when a position has no market data', async () => {
      const userId = await userWith([
        cashIn(10000),
        filled('BUY', 'ALFA', 10, '100.00', '2026-11-03 10:00:00'),
        filled('BUY', 'NODT', 10, '5.00', '2026-11-03 11:00:00'),
      ]);

      const body = await portfolioOf(userId);

      expect(body.valuationComplete).toBe(false);
      expect(body.totalAccountValue).toBeNull();
      expect(body.unpricedInstrumentIds).toEqual([fixtureInstrumentId('NODT')]);
      // The cash side is still reported, and the priced position is valued.
      expect(body.cashBalance).toBe('8950.00');
      expect(body.availableCash).toBe('8950.00');
      expect(position(body, 'ALFA')).toMatchObject({ marketValue: '1050.00' });
      expect(position(body, 'NODT')).toEqual({
        instrumentId: fixtureInstrumentId('NODT'),
        ticker: 'NODT',
        name: 'Sin Datos S.A.',
        quantity: 10,
        lastPrice: null,
        marketValue: null,
        averageCost: '5.00',
        totalReturnPercent: null,
        dailyPriceChangePercent: null,
      });
    });

    it('does not fall back to an older close when the latest row has none', async () => {
      const userId = await userWith([
        cashIn(1000),
        filled('BUY', 'XNCL', 4, '10.00', '2026-11-03 10:00:00'),
      ]);

      const body = await portfolioOf(userId);

      expect(body.valuationComplete).toBe(false);
      expect(body.totalAccountValue).toBeNull();
      expect(body.unpricedInstrumentIds).toEqual([idOf('XNCL')]);
      expect(position(body, 'XNCL').lastPrice).toBeNull();
    });
  });

  describe('negative holdings from historical data', () => {
    it('lists the position with negative quantity and value, without cost-based figures', async () => {
      const userId = await userWith([
        cashIn(100000),
        filled('BUY', 'ALFA', 20, '100.00', '2026-11-03 10:00:00'),
        filled('SELL', 'ALFA', 30, '110.00', '2026-11-04 10:00:00'),
      ]);

      const body = await portfolioOf(userId);

      // 100,000 - 2,000 + 3,300
      expect(body.cashBalance).toBe('101300.00');
      expect(body.positions).toEqual([
        {
          instrumentId: fixtureInstrumentId('ALFA'),
          ticker: 'ALFA',
          name: 'Alfa Energía S.A.',
          quantity: -10,
          lastPrice: '105.00',
          marketValue: '-1050.00',
          averageCost: null,
          totalReturnPercent: null,
          dailyPriceChangePercent: '2.94',
        },
      ]);
      expect(body.totalAccountValue).toBe('100250.00'); // 101,300 - 1,050
      expect(body.valuationComplete).toBe(true);
    });
  });

  describe('ordering and precision', () => {
    it('orders positions by ticker whatever the order of purchase, and is repeatable', async () => {
      const userId = await userWith([
        filled('BUY', 'SIGM', 1, '1.00', '2026-11-03 10:00:00'),
        filled('BUY', 'GAMA', 1, '1.00', '2026-11-03 10:01:00'),
        filled('BUY', 'BETA', 1, '1.00', '2026-11-03 10:02:00'),
        filled('BUY', 'ALFA', 1, '1.00', '2026-11-03 10:03:00'),
      ]);

      const first = await portfolioOf(userId);
      const second = await portfolioOf(userId);

      expect(first.positions.map((p) => p.ticker)).toEqual([
        'ALFA',
        'BETA',
        'GAMA',
        'SIGM',
      ]);
      expect(second).toEqual(first);
    });

    it('keeps exact cents on amounts beyond double precision', async () => {
      // 999,999 * 99,999,999.99 = 99,999,899,990,000.01: more significant
      // digits than a double can hold.
      const userId = await userWith([
        filled('BUY', 'ALFA', 999999, '99999999.99', '2026-11-03 10:00:00'),
      ]);

      const body = await portfolioOf(userId);

      expect(body.cashBalance).toBe('-99999899990000.01');
      expect(body.availableCash).toBe('-99999899990000.01');
      expect(position(body, 'ALFA')).toMatchObject({
        quantity: 999999,
        marketValue: '104999895.00',
        averageCost: '99999999.99',
      });
      expect(body.totalAccountValue).toBe('-99999794990105.01');
    });
  });

  describe('query budget', () => {
    /** SQL text of every statement sent to PostgreSQL while `run` executes. */
    async function statementsDuring(
      run: () => Promise<unknown>,
    ): Promise<string[]> {
      // Every statement TypeORM sends goes through the query runner's `query`.
      const runner = dataSource.createQueryRunner();
      const prototype = Object.getPrototypeOf(runner) as {
        query: (sql: string, ...rest: unknown[]) => Promise<unknown>;
      };
      await runner.release();

      const spy = jest.spyOn(prototype, 'query');
      try {
        await run();
        return spy.mock.calls.map(([sql]) => sql);
      } finally {
        spy.mockRestore();
      }
    }

    it('reads in one read-only repeatable-read snapshot with a fixed number of queries', async () => {
      const single = await userWith([
        cashIn(1000),
        filled('BUY', 'ALFA', 1, '1.00', '2026-11-03 10:00:00'),
      ]);
      const many = await userWith([
        cashIn(1000),
        filled('BUY', 'ALFA', 1, '1.00', '2026-11-03 10:00:00'),
        filled('BUY', 'BETA', 1, '1.00', '2026-11-03 10:01:00'),
        filled('BUY', 'GAMA', 1, '1.00', '2026-11-03 10:02:00'),
        filled('BUY', 'SIGM', 1, '1.00', '2026-11-03 10:03:00'),
        filled('BUY', 'NODT', 1, '1.00', '2026-11-03 10:04:00'),
      ]);

      const withOne = await statementsDuring(() => portfolioOf(single));
      const withFive = await statementsDuring(() => portfolioOf(many));

      for (const statements of [withOne, withFive]) {
        // Both modes are set before the first query, i.e. before the snapshot.
        expect(statements.slice(0, 3)).toEqual([
          'START TRANSACTION',
          'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
          'SET TRANSACTION READ ONLY',
        ]);
        expect(statements.at(-1)).toBe('COMMIT');
        const queries = statements.slice(3, -1);
        // user, ledger orders, latest prices, instruments
        expect(queries).toHaveLength(4);
        for (const sql of queries) expect(sql).toMatch(/^SELECT /);
      }
    });

    it('skips the price and instrument queries when nothing is held', async () => {
      const userId = await userWith([cashIn(1000)]);

      const statements = await statementsDuring(() => portfolioOf(userId));

      expect(statements.slice(3, -1)).toHaveLength(2);
    });
  });

  describe('invalid and unknown users', () => {
    it.each([
      ['a non-numeric id', 'abc'],
      ['zero', '0'],
      ['a negative id', '-1'],
      ['a decimal', '1.5'],
      ['an exponent', '1e3'],
      ['a hexadecimal', '0x10'],
      ['a signed id', '+1'],
      ['a value above the INT range', '2147483648'],
      ['a huge digit string', '99999999999999999999'],
    ])('rejects %s with 400', async (_label, userId) => {
      const response = await get(userId).expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
      const { details } = response.body as { details: { field: string }[] };
      expect(details.length).toBeGreaterThan(0);
      expect(details.every((detail) => detail.field === 'userId')).toBe(true);
    });

    it('answers 404 USER_NOT_FOUND for a valid id that does not exist', async () => {
      const response = await get(2147483647).expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User 2147483647 not found',
      });
    });

    it('accepts the largest valid id as a well-formed request', async () => {
      // 404 (not 400/500) proves it passed validation and reached the lookup.
      await get(2147483647).expect(404);
    });
  });
});
