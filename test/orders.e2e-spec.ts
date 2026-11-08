import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { fixtureInstrumentId } from './fixtures/instruments';
import { createTestApp } from './setup/create-test-app';
import { TestOrder, insertTestOrders } from './setup/create-test-orders';
import { createTestUser } from './setup/create-test-user';
import {
  OrderResponse,
  cashInOrder,
  countAllOrders,
  getPortfolio,
  orderRowsOf,
  postOrder,
} from './setup/order-requests';

/**
 * Prices (latest close) of the shared fixtures used below:
 * ALFA 105.00 (2026-11-06 beats 2026-11-05's 102.00), ALFAB 49.50,
 * SIGM 710.50 (two rows on the latest date: the higher id wins), NODT none.
 */
const ALFA = fixtureInstrumentId('ALFA');
const ALFAB = fixtureInstrumentId('ALFAB');
const SIGM = fixtureInstrumentId('SIGM');
const NODT = fixtureInstrumentId('NODT');
const ARS = fixtureInstrumentId('ARS');

const EXTRA_INSTRUMENTS = {
  // Latest close is 0.00: not a usable execution price.
  OZRO: [{ date: '2026-11-06', close: '0.00' }],
  // Latest row has no close; the older close must NOT be used instead.
  ONUL: [
    { date: '2026-11-06', close: null },
    { date: '2026-11-05', close: '5.00' },
  ],
} as const;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('POST /orders', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const extraIds = new Map<string, number>();

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);

    for (const [ticker, rows] of Object.entries(EXTRA_INSTRUMENTS)) {
      const [{ id }] = await dataSource.query<{ id: number }[]>(
        `INSERT INTO instruments (ticker, name, type) VALUES ($1, $2, 'ACCIONES') RETURNING id`,
        [ticker, `Orders test ${ticker}`],
      );
      extraIds.set(ticker, id);
      for (const row of rows) {
        await dataSource.query(
          `INSERT INTO marketdata (instrumentid, close, previousclose, date) VALUES ($1, $2, '1.00', $3)`,
          [id, row.close, row.date],
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

  const idOf = (ticker: string): number =>
    extraIds.get(ticker) ?? fixtureInstrumentId(ticker);

  async function userWith(...orders: TestOrder[]): Promise<number> {
    const userId = await createTestUser(dataSource);
    await insertTestOrders(dataSource, userId, orders, idOf);
    return userId;
  }

  const boughtAlfa = (size: number, price = '100.00'): TestOrder => ({
    ticker: 'ALFA',
    side: 'BUY',
    size,
    price,
    datetime: '2026-11-03 11:00:00',
  });

  const base = (userId: number, instrumentId = ALFA) => ({
    userId,
    instrumentId,
  });

  const body = (res: { body: unknown }) => res.body as OrderResponse;

  describe('MARKET BUY', () => {
    it('fills at the latest close, persists the order and updates the portfolio', async () => {
      const userId = await userWith(cashInOrder(100000));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'MARKET',
        size: 10,
      }).expect(201);

      expect(response.body).toEqual({
        id: expect.any(Number) as number,
        userId,
        instrumentId: ALFA,
        side: 'BUY',
        type: 'MARKET',
        status: 'FILLED',
        size: 10,
        price: '105.00',
        datetime: expect.stringMatching(ISO_UTC) as string,
        rejectionReason: null,
      });

      const rows = await orderRowsOf(dataSource, userId);
      expect(rows.at(-1)).toMatchObject({
        id: body(response).id,
        instrumentid: ALFA,
        userid: userId,
        size: 10,
        price: '105.00',
        type: 'MARKET',
        side: 'BUY',
        status: 'FILLED',
        datetime: body(response).datetime,
      });
      expect(rows).toHaveLength(2);

      const portfolio = await getPortfolio(app, userId);
      expect(portfolio).toMatchObject({
        cashBalance: '98950.00',
        availableCash: '98950.00',
        totalAccountValue: '100000.00',
      });
      expect(portfolio.positions).toEqual([
        expect.objectContaining({
          instrumentId: ALFA,
          quantity: 10,
          lastPrice: '105.00',
          marketValue: '1050.00',
          averageCost: '105.00',
        }),
      ]);
    });

    it('uses the highest-id row when the latest date has several', async () => {
      const userId = await userWith(cashInOrder(100000));

      const response = await postOrder(app, {
        ...base(userId, SIGM),
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      }).expect(201);

      expect(body(response).price).toBe('710.50');
    });

    it('can spend the exact available cash and nothing more', async () => {
      const userId = await userWith(cashInOrder(1050));
      const buy = (size: number) =>
        postOrder(app, {
          ...base(userId),
          side: 'BUY',
          type: 'MARKET',
          size,
        }).expect(201);

      expect(body(await buy(10)).status).toBe('FILLED');
      expect((await getPortfolio(app, userId)).cashBalance).toBe('0.00');
      expect(body(await buy(1))).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
    });
  });

  describe('quantity from an ARS amount', () => {
    it.each([
      ['1000.00', 9], // floor(1000 / 105)
      ['210.00', 2], // exact division
      ['105.00', 1],
      ['209.99', 1],
      ['1000', 9],
      ['1000.5', 9],
    ])('MARKET BUY amount %s buys %i whole shares', async (amount, shares) => {
      const userId = await userWith(cashInOrder(100000));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'MARKET',
        amount,
      }).expect(201);

      expect(body(response)).toMatchObject({
        status: 'FILLED',
        size: shares,
        price: '105.00',
      });
      expect((await getPortfolio(app, userId)).cashBalance).toBe(
        (100000 - shares * 105).toFixed(2),
      );
    });

    it('sizes a LIMIT order with the limit price, not the market price', async () => {
      const userId = await userWith(cashInOrder(100000));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        amount: '1000.00',
        price: '300.00',
      }).expect(201);

      expect(body(response)).toMatchObject({
        status: 'NEW',
        size: 3,
        price: '300.00',
      });
    });

    it('sizes a SELL by amount too', async () => {
      const userId = await userWith(cashInOrder(1000), boughtAlfa(10));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'SELL',
        type: 'MARKET',
        amount: '330.00',
      }).expect(201);

      expect(body(response)).toMatchObject({ status: 'FILLED', size: 3 });
    });

    it('rejects an amount below one share with 422 ZERO_QUANTITY and persists nothing', async () => {
      const userId = await userWith(cashInOrder(100000));
      const before = await orderRowsOf(dataSource, userId);

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'MARKET',
        amount: '104.99',
      }).expect(422);

      expect(response.body).toMatchObject({
        statusCode: 422,
        code: 'ZERO_QUANTITY',
      });
      expect(await orderRowsOf(dataSource, userId)).toEqual(before);
    });

    it('rejects an amount yielding more shares than INT with 422 QUANTITY_OUT_OF_RANGE', async () => {
      const userId = await userWith(cashInOrder(100000));
      const before = await countAllOrders(dataSource);

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        amount: '99999999.99',
        price: '0.01',
      }).expect(422);

      expect(response.body).toMatchObject({
        statusCode: 422,
        code: 'QUANTITY_OUT_OF_RANGE',
      });
      expect(await countAllOrders(dataSource)).toBe(before);
    });

    it('accepts an amount yielding exactly the INT maximum, but not one share more', async () => {
      const userId = await userWith();

      // 21474836.47 / 0.01 = 2147483647 shares: fits the INT column.
      const atLimit = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        amount: '21474836.47',
        price: '0.01',
      }).expect(201);
      expect(body(atLimit)).toMatchObject({
        size: 2147483647,
        status: 'REJECTED', // no cash, but the order itself was valid and persisted
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
      expect(
        (await orderRowsOf(dataSource, userId)).map((row) => row.size),
      ).toEqual([2147483647]);

      const beyond = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        amount: '21474836.48',
        price: '0.01',
      }).expect(422);
      expect(beyond.body).toMatchObject({ code: 'QUANTITY_OUT_OF_RANGE' });
    });
  });

  describe('MARKET SELL', () => {
    it('fills at the latest close and updates shares and cash', async () => {
      const userId = await userWith(cashInOrder(10000), boughtAlfa(10));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'SELL',
        type: 'MARKET',
        size: 4,
      }).expect(201);

      expect(body(response)).toMatchObject({
        side: 'SELL',
        type: 'MARKET',
        status: 'FILLED',
        size: 4,
        price: '105.00',
        rejectionReason: null,
      });
      const portfolio = await getPortfolio(app, userId);
      // 10000 - 10 * 100 (seed purchase) + 4 * 105
      expect(portfolio.cashBalance).toBe('9420.00');
      expect(portfolio.positions).toEqual([
        expect.objectContaining({
          quantity: 6,
          averageCost: '100.00', // a sale does not change the average cost
          marketValue: '630.00',
        }),
      ]);
    });

    it('can sell the whole holding, closing the position', async () => {
      const userId = await userWith(cashInOrder(10000), boughtAlfa(10));

      await postOrder(app, {
        ...base(userId),
        side: 'SELL',
        type: 'MARKET',
        size: 10,
      }).expect(201);

      const portfolio = await getPortfolio(app, userId);
      expect(portfolio.positions).toEqual([]);
      expect(portfolio.cashBalance).toBe('10050.00'); // 10000 - 1000 + 1050
    });

    it('chains orders: a purchase placed through the API can be sold right after', async () => {
      const userId = await userWith(cashInOrder(1000));

      await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'MARKET',
        size: 5,
      }).expect(201);
      const sale = await postOrder(app, {
        ...base(userId),
        side: 'SELL',
        type: 'MARKET',
        size: 5,
      }).expect(201);

      expect(body(sale).status).toBe('FILLED');
      const portfolio = await getPortfolio(app, userId);
      expect(portfolio.positions).toEqual([]);
      expect(portfolio.cashBalance).toBe('1000.00');
    });
  });

  describe('LIMIT orders', () => {
    it('LIMIT BUY is NEW at the limit price and reserves cash without executing', async () => {
      const userId = await userWith(cashInOrder(10000));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        size: 10,
        price: '950.50',
      }).expect(201);

      expect(body(response)).toMatchObject({
        type: 'LIMIT',
        status: 'NEW',
        size: 10,
        price: '950.50',
        rejectionReason: null,
      });
      expect((await orderRowsOf(dataSource, userId)).at(-1)).toMatchObject({
        type: 'LIMIT',
        status: 'NEW',
        price: '950.50',
      });
      const portfolio = await getPortfolio(app, userId);
      expect(portfolio).toMatchObject({
        cashBalance: '10000.00', // nothing executed
        availableCash: '495.00', // 10000 - 10 * 950.50 reserved
        totalAccountValue: '10000.00',
        positions: [],
      });
    });

    it('LIMIT SELL is NEW and reserves shares without changing the executed holding', async () => {
      const userId = await userWith(cashInOrder(10000), boughtAlfa(10));
      const cashBefore = (await getPortfolio(app, userId)).cashBalance;

      const response = await postOrder(app, {
        ...base(userId),
        side: 'SELL',
        type: 'LIMIT',
        size: 6,
        price: '200.00',
      }).expect(201);

      expect(body(response)).toMatchObject({ status: 'NEW', price: '200.00' });
      const portfolio = await getPortfolio(app, userId);
      expect(portfolio.cashBalance).toBe(cashBefore);
      expect(portfolio.positions).toEqual([
        expect.objectContaining({ quantity: 10 }),
      ]);
    });

    it('is persisted as NEW even when the limit is far from the market', async () => {
      const userId = await userWith(cashInOrder(1000));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: '0.01',
      }).expect(201);

      expect(body(response).status).toBe('NEW');
    });

    it('accepts a LIMIT order on an instrument without market data', async () => {
      const userId = await userWith(cashInOrder(1000));

      const response = await postOrder(app, {
        ...base(userId, NODT),
        side: 'BUY',
        type: 'LIMIT',
        size: 2,
        price: '10.00',
      }).expect(201);

      expect(body(response)).toMatchObject({ status: 'NEW', price: '10.00' });
    });
  });

  describe('rejections (persisted, HTTP 201)', () => {
    it('BUY above the available cash is REJECTED with INSUFFICIENT_FUNDS', async () => {
      const userId = await userWith(cashInOrder(1000));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'MARKET',
        size: 10, // 1050.00 > 1000
      }).expect(201);

      expect(body(response)).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_FUNDS',
        size: 10,
        price: '105.00',
      });
      expect((await orderRowsOf(dataSource, userId)).at(-1)).toMatchObject({
        id: body(response).id,
        status: 'REJECTED',
        side: 'BUY',
        type: 'MARKET',
        size: 10,
        price: '105.00',
      });
      const portfolio = await getPortfolio(app, userId);
      expect(portfolio).toMatchObject({
        cashBalance: '1000.00',
        availableCash: '1000.00',
        positions: [],
      });
    });

    it('a REJECTED order reserves nothing', async () => {
      const userId = await userWith(cashInOrder(1000));
      await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        size: 100,
        price: '100.00',
      }).expect(201); // 10000 > 1000: REJECTED

      const next = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'MARKET',
        size: 9,
      }).expect(201);

      expect(body(next).status).toBe('FILLED');
    });

    it('BUY on an account without any cash is REJECTED', async () => {
      const userId = await userWith();

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      }).expect(201);

      expect(body(response)).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
    });

    it('SELL without holdings is REJECTED with INSUFFICIENT_SHARES', async () => {
      const userId = await userWith(cashInOrder(1000));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'SELL',
        type: 'MARKET',
        size: 1,
      }).expect(201);

      expect(body(response)).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_SHARES',
      });
      expect((await orderRowsOf(dataSource, userId)).at(-1)).toMatchObject({
        status: 'REJECTED',
        side: 'SELL',
      });
    });

    it('SELL above the held shares is REJECTED and leaves the holding untouched', async () => {
      const userId = await userWith(cashInOrder(1000), boughtAlfa(10));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'SELL',
        type: 'MARKET',
        size: 11,
      }).expect(201);

      expect(body(response)).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_SHARES',
        size: 11,
      });
      const portfolio = await getPortfolio(app, userId);
      expect(portfolio.positions).toEqual([
        expect.objectContaining({ quantity: 10 }),
      ]);
    });

    it('shares of other instruments do not count', async () => {
      const userId = await userWith(cashInOrder(1000), boughtAlfa(10));

      const response = await postOrder(app, {
        ...base(userId, ALFAB),
        side: 'SELL',
        type: 'MARKET',
        size: 1,
      }).expect(201);

      expect(body(response).rejectionReason).toBe('INSUFFICIENT_SHARES');
    });

    describe('existing NEW reservations', () => {
      it('a NEW LIMIT BUY (placed through the API) reduces the cash available to the next BUY', async () => {
        const userId = await userWith(cashInOrder(10000));
        await postOrder(app, {
          ...base(userId),
          side: 'BUY',
          type: 'LIMIT',
          size: 10,
          price: '950.50', // reserves 9505.00
        }).expect(201);

        const tooMuch = await postOrder(app, {
          ...base(userId),
          side: 'BUY',
          type: 'MARKET',
          size: 5, // 525.00 > 495.00 still available
        }).expect(201);
        const fits = await postOrder(app, {
          ...base(userId),
          side: 'BUY',
          type: 'MARKET',
          size: 4, // 420.00 <= 495.00
        }).expect(201);

        expect(body(tooMuch)).toMatchObject({
          status: 'REJECTED',
          rejectionReason: 'INSUFFICIENT_FUNDS',
        });
        expect(body(fits).status).toBe('FILLED');
      });

      it('a NEW BUY inserted by someone else counts too', async () => {
        const userId = await userWith(cashInOrder(1000), {
          ticker: 'ALFAB',
          side: 'BUY',
          size: 18,
          price: '50.00',
          type: 'LIMIT',
          status: 'NEW',
          datetime: '2026-11-04 10:00:00',
        }); // reserves 900.00

        const response = await postOrder(app, {
          ...base(userId),
          side: 'BUY',
          type: 'MARKET',
          size: 1, // 105.00 > 100.00 available
        }).expect(201);

        expect(body(response).rejectionReason).toBe('INSUFFICIENT_FUNDS');
      });

      it('a NEW LIMIT SELL (placed through the API) reserves the shares', async () => {
        const userId = await userWith(cashInOrder(1000), boughtAlfa(10));
        await postOrder(app, {
          ...base(userId),
          side: 'SELL',
          type: 'LIMIT',
          size: 6,
          price: '200.00',
        }).expect(201);

        const tooMany = await postOrder(app, {
          ...base(userId),
          side: 'SELL',
          type: 'MARKET',
          size: 5, // only 4 left unreserved
        }).expect(201);
        const fits = await postOrder(app, {
          ...base(userId),
          side: 'SELL',
          type: 'MARKET',
          size: 4,
        }).expect(201);
        const none = await postOrder(app, {
          ...base(userId),
          side: 'SELL',
          type: 'LIMIT',
          size: 1,
          price: '200.00',
        }).expect(201);

        expect(body(tooMany)).toMatchObject({
          status: 'REJECTED',
          rejectionReason: 'INSUFFICIENT_SHARES',
        });
        expect(body(fits).status).toBe('FILLED');
        expect(body(none)).toMatchObject({
          status: 'REJECTED',
          rejectionReason: 'INSUFFICIENT_SHARES',
        });
      });

      it('a NEW SELL inserted by someone else counts too', async () => {
        const userId = await userWith(cashInOrder(1000), boughtAlfa(10), {
          ticker: 'ALFA',
          side: 'SELL',
          size: 10,
          price: '300.00',
          type: 'LIMIT',
          status: 'NEW',
          datetime: '2026-11-04 10:00:00',
        });

        const response = await postOrder(app, {
          ...base(userId),
          side: 'SELL',
          type: 'MARKET',
          size: 1,
        }).expect(201);

        expect(body(response).rejectionReason).toBe('INSUFFICIENT_SHARES');
      });

      it('CANCELLED and REJECTED seed orders reserve nothing', async () => {
        const userId = await userWith(
          cashInOrder(1000),
          {
            ticker: 'ALFA',
            side: 'BUY',
            size: 100,
            price: '100.00',
            type: 'LIMIT',
            status: 'CANCELLED',
            datetime: '2026-11-04 10:00:00',
          },
          {
            ticker: 'ALFA',
            side: 'BUY',
            size: 100,
            price: '100.00',
            status: 'REJECTED',
            datetime: '2026-11-04 11:00:00',
          },
        );

        const response = await postOrder(app, {
          ...base(userId),
          side: 'BUY',
          type: 'MARKET',
          size: 9,
        }).expect(201);

        expect(body(response).status).toBe('FILLED');
      });
    });

    describe('anomalous negative holding', () => {
      // Bought 20, sold 30 (historical data): the position is -10.
      const oversold = (): TestOrder[] => [
        cashInOrder(100000),
        boughtAlfa(20),
        {
          ticker: 'ALFA',
          side: 'SELL',
          size: 30,
          price: '110.00',
          datetime: '2026-11-04 11:00:00',
        },
      ];

      it.each([
        ['MARKET', { type: 'MARKET' }],
        ['LIMIT', { type: 'LIMIT', price: '500.00' }],
      ])(
        'a new %s SELL is REJECTED and cannot deepen the short',
        async (_name, extra) => {
          const userId = await userWith(...oversold());

          const response = await postOrder(app, {
            ...base(userId),
            side: 'SELL',
            size: 1,
            ...extra,
          }).expect(201);

          expect(body(response)).toMatchObject({
            status: 'REJECTED',
            rejectionReason: 'INSUFFICIENT_SHARES',
          });
          const portfolio = await getPortfolio(app, userId);
          expect(portfolio.positions).toEqual([
            expect.objectContaining({ quantity: -10 }),
          ]);
        },
      );

      it('a BUY is still allowed and moves the position towards zero', async () => {
        const userId = await userWith(...oversold());

        const response = await postOrder(app, {
          ...base(userId),
          side: 'BUY',
          type: 'MARKET',
          size: 10,
        }).expect(201);

        expect(body(response).status).toBe('FILLED');
        expect((await getPortfolio(app, userId)).positions).toEqual([]);
      });
    });
  });

  describe('validation (400, nothing persisted)', () => {
    const valid = {
      userId: 1,
      instrumentId: ALFA,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '10.00',
    };

    it.each([
      ['LIMIT without price', { ...valid, price: undefined }, 'price'],
      [
        'MARKET with price',
        { ...valid, type: 'MARKET', price: '10.00' },
        'price',
      ],
      ['size and amount together', { ...valid, amount: '100.00' }, 'amount'],
      ['neither size nor amount', { ...valid, size: undefined }, 'size'],
      ['price with 3 decimals', { ...valid, price: '10.001' }, 'price'],
      [
        'amount with 3 decimals',
        { ...valid, size: undefined, amount: '10.001' },
        'amount',
      ],
      [
        'price above NUMERIC(10,2)',
        { ...valid, price: '100000000.00' },
        'price',
      ],
      ['zero price', { ...valid, price: '0.00' }, 'price'],
      ['negative price', { ...valid, price: '-5.00' }, 'price'],
      ['numeric price', { ...valid, price: 10 }, 'price'],
      ['exponent price', { ...valid, price: '1e1' }, 'price'],
      [
        'zero amount',
        {
          ...valid,
          type: 'MARKET',
          price: undefined,
          size: undefined,
          amount: '0',
        },
        'amount',
      ],
      [
        'numeric amount',
        {
          ...valid,
          type: 'MARKET',
          price: undefined,
          size: undefined,
          amount: 100,
        },
        'amount',
      ],
      ['CASH_IN side', { ...valid, side: 'CASH_IN' }, 'side'],
      ['CASH_OUT side', { ...valid, side: 'CASH_OUT' }, 'side'],
      ['lowercase side', { ...valid, side: 'buy' }, 'side'],
      ['unknown type', { ...valid, type: 'STOP' }, 'type'],
      ['unknown field', { ...valid, status: 'FILLED' }, 'status'],
      [
        'client-supplied datetime',
        { ...valid, datetime: '2026-01-01' },
        'datetime',
      ],
      ['size above INT max', { ...valid, size: 2147483648 }, 'size'],
      ['zero size', { ...valid, size: 0 }, 'size'],
      ['negative size', { ...valid, size: -1 }, 'size'],
      ['fractional size', { ...valid, size: 1.5 }, 'size'],
      ['string size', { ...valid, size: '1' }, 'size'],
      ['string userId', { ...valid, userId: '1' }, 'userId'],
      ['zero userId', { ...valid, userId: 0 }, 'userId'],
      ['userId above INT max', { ...valid, userId: 2147483648 }, 'userId'],
      ['zero instrumentId', { ...valid, instrumentId: 0 }, 'instrumentId'],
      ['missing userId', { ...valid, userId: undefined }, 'userId'],
      [
        'missing instrumentId',
        { ...valid, instrumentId: undefined },
        'instrumentId',
      ],
      ['missing side', { ...valid, side: undefined }, 'side'],
      ['missing type', { ...valid, type: undefined }, 'type'],
    ])('%s', async (_name, payload, field) => {
      const before = await countAllOrders(dataSource);

      const response = await postOrder(app, payload).expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        details: expect.arrayContaining([
          expect.objectContaining({ field }),
        ]) as unknown[],
      });
      expect(await countAllOrders(dataSource)).toBe(before);
    });

    it.each([
      ['an empty object', {}],
      ['an array', [valid]],
    ])('rejects %s as a body', async (_name, payload) => {
      const before = await countAllOrders(dataSource);

      await postOrder(app, payload).expect(400);

      expect(await countAllOrders(dataSource)).toBe(before);
    });

    it('rejects a missing and a malformed JSON body', async () => {
      const before = await countAllOrders(dataSource);

      await postOrder(app).expect(400);
      await postOrder(app, undefined)
        .set('Content-Type', 'application/json')
        .send('{"userId": 1,')
        .expect(400);

      expect(await countAllOrders(dataSource)).toBe(before);
    });

    it('accepts the largest explicit size (it is then just too expensive)', async () => {
      const userId = await userWith(cashInOrder(1000));

      const response = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'MARKET',
        size: 2147483647,
      }).expect(201);

      expect(body(response)).toMatchObject({
        size: 2147483647,
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_FUNDS',
      });
    });

    it('accepts the largest price and the smallest price', async () => {
      const userId = await userWith(cashInOrder(1000));

      const high = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: '99999999.99',
      }).expect(201);
      const low = await postOrder(app, {
        ...base(userId),
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: '0.01',
      }).expect(201);

      expect(body(high)).toMatchObject({
        price: '99999999.99',
        status: 'REJECTED',
      });
      expect(body(low)).toMatchObject({ price: '0.01', status: 'NEW' });
    });
  });

  describe('references and instruments (nothing persisted)', () => {
    it('unknown user -> 404 USER_NOT_FOUND', async () => {
      const before = await countAllOrders(dataSource);

      const response = await postOrder(app, {
        userId: 2147483647,
        instrumentId: ALFA,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      }).expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      });
      expect(await countAllOrders(dataSource)).toBe(before);
    });

    it('unknown instrument -> 404 INSTRUMENT_NOT_FOUND', async () => {
      const userId = await userWith(cashInOrder(1000));
      const before = await orderRowsOf(dataSource, userId);

      const response = await postOrder(app, {
        userId,
        instrumentId: 2147483647,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      }).expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        code: 'INSTRUMENT_NOT_FOUND',
      });
      expect(await orderRowsOf(dataSource, userId)).toEqual(before);
    });

    it.each([
      ['MARKET', { type: 'MARKET' }],
      ['LIMIT', { type: 'LIMIT', price: '1.00' }],
    ])(
      'the cash instrument cannot be traded (%s) -> 422 INSTRUMENT_NOT_TRADABLE',
      async (_name, extra) => {
        const userId = await userWith(cashInOrder(1000));
        const before = await orderRowsOf(dataSource, userId);

        const response = await postOrder(app, {
          userId,
          instrumentId: ARS,
          side: 'BUY',
          size: 1,
          ...extra,
        }).expect(422);

        expect(response.body).toMatchObject({
          statusCode: 422,
          code: 'INSTRUMENT_NOT_TRADABLE',
        });
        expect(await orderRowsOf(dataSource, userId)).toEqual(before);
      },
    );

    it.each([
      ['no market data', () => NODT],
      [
        'a latest row without close (no fallback to an older close)',
        () => idOf('ONUL'),
      ],
      ['a latest close of zero', () => idOf('OZRO')],
    ])(
      'MARKET order with %s -> 422 PRICE_UNAVAILABLE',
      async (_name, instrumentOf) => {
        const userId = await userWith(cashInOrder(1000));
        const before = await orderRowsOf(dataSource, userId);

        const response = await postOrder(app, {
          userId,
          instrumentId: instrumentOf(),
          side: 'BUY',
          type: 'MARKET',
          size: 1,
        }).expect(422);

        expect(response.body).toMatchObject({
          statusCode: 422,
          code: 'PRICE_UNAVAILABLE',
        });
        expect(await orderRowsOf(dataSource, userId)).toEqual(before);
      },
    );

    it('PRICE_UNAVAILABLE also applies when sizing by amount', async () => {
      const userId = await userWith(cashInOrder(1000));

      const response = await postOrder(app, {
        userId,
        instrumentId: idOf('OZRO'),
        side: 'BUY',
        type: 'MARKET',
        amount: '100.00',
      }).expect(422);

      expect(response.body).toMatchObject({ code: 'PRICE_UNAVAILABLE' });
    });
  });

  it('keeps the other users and the existing endpoints untouched', async () => {
    const bystander = await userWith(cashInOrder(5000), boughtAlfa(5));
    const before = await getPortfolio(app, bystander);
    const userId = await userWith(cashInOrder(1000));

    await postOrder(app, {
      ...base(userId),
      side: 'BUY',
      type: 'MARKET',
      size: 3,
    }).expect(201);

    expect(await getPortfolio(app, bystander)).toEqual(before);
  });
});
