import { parseDecimal } from '../../common/decimal';
import {
  AccountLedger,
  LedgerOrder,
  averageCost,
  buildAccountLedger,
} from './account-ledger';
import { OrderSide, OrderStatus, OrderType } from './order.types';

const STOCK = 10;
const OTHER_STOCK = 20;
const CASH = 1;

let nextId: number;
beforeEach(() => {
  nextId = 1;
});

interface OrderSpec {
  side: OrderSide;
  size: number;
  price?: string;
  instrumentId?: number;
  status?: OrderStatus;
  type?: OrderType;
  id?: number;
  datetime?: Date;
}

/** By default ids and timestamps grow together. */
function order(spec: OrderSpec): LedgerOrder {
  const id = spec.id ?? nextId++;
  const isCash =
    spec.side === OrderSide.CASH_IN || spec.side === OrderSide.CASH_OUT;
  return {
    id,
    instrumentId: spec.instrumentId ?? (isCash ? CASH : STOCK),
    side: spec.side,
    type: spec.type ?? OrderType.MARKET,
    status: spec.status ?? OrderStatus.FILLED,
    size: spec.size,
    price: spec.price === undefined ? null : parseDecimal(spec.price),
    datetime: spec.datetime ?? new Date(Date.UTC(2026, 0, 1, 0, 0, id)),
  };
}

const cashIn = (size: number) =>
  order({ side: OrderSide.CASH_IN, size, price: '1' });
const cashOut = (size: number) =>
  order({ side: OrderSide.CASH_OUT, size, price: '1' });
const buy = (size: number, price: string, rest: Partial<OrderSpec> = {}) =>
  order({ side: OrderSide.BUY, size, price, ...rest });
const sell = (size: number, price: string, rest: Partial<OrderSpec> = {}) =>
  order({ side: OrderSide.SELL, size, price, ...rest });

function holding(ledger: AccountLedger, instrumentId = STOCK) {
  const found = ledger.holdings.get(instrumentId);
  if (!found) throw new Error(`No holding for instrument ${instrumentId}`);
  return found;
}

const costBasisOf = (ledger: AccountLedger, instrumentId = STOCK) =>
  holding(ledger, instrumentId).costBasis?.toFixed() ?? null;
const avgCostOf = (ledger: AccountLedger, instrumentId = STOCK) =>
  averageCost(holding(ledger, instrumentId))?.toFixed() ?? null;

describe('buildAccountLedger', () => {
  it('returns zeros for a user without orders', () => {
    const ledger = buildAccountLedger([]);

    expect(ledger.cashBalance.toFixed()).toBe('0');
    expect(ledger.reservedCash.toFixed()).toBe('0');
    expect(ledger.availableCash.toFixed()).toBe('0');
    expect(ledger.holdings.size).toBe(0);
  });

  describe('cash movements', () => {
    it('adds CASH_IN and subtracts CASH_OUT using size as the ARS amount', () => {
      const ledger = buildAccountLedger([cashIn(1_000_000), cashOut(100_000)]);

      expect(ledger.cashBalance.toFixed()).toBe('900000');
      expect(ledger.availableCash.toFixed()).toBe('900000');
    });

    it('creates no holdings for cash orders and ignores their price', () => {
      const ledger = buildAccountLedger([
        order({ side: OrderSide.CASH_IN, size: 500 }), // no price at all
        order({ side: OrderSide.CASH_OUT, size: 200, price: '1' }),
      ]);

      expect(ledger.cashBalance.toFixed()).toBe('300');
      expect(ledger.holdings.size).toBe(0);
    });

    it('reserves nothing for NEW cash transfers', () => {
      const ledger = buildAccountLedger([
        cashIn(1000),
        order({ side: OrderSide.CASH_OUT, size: 400, status: OrderStatus.NEW }),
      ]);

      expect(ledger.cashBalance.toFixed()).toBe('1000');
      expect(ledger.reservedCash.toFixed()).toBe('0');
    });
  });

  describe('FILLED trades', () => {
    it('settles FILLED MARKET and LIMIT orders identically', () => {
      const ledger = buildAccountLedger([
        cashIn(10_000),
        buy(10, '100.50', { type: OrderType.MARKET }),
        buy(10, '99.50', { type: OrderType.LIMIT }),
        sell(5, '110', { type: OrderType.LIMIT }),
      ]);

      // 10_000 - 1005 - 995 + 550
      expect(ledger.cashBalance.toFixed()).toBe('8550');
      expect(holding(ledger).quantity).toBe(15);
      // cost basis 2000 for 20 shares; selling 5 removes a quarter of it
      expect(costBasisOf(ledger)).toBe('1500');
    });

    it('tracks each instrument independently', () => {
      const ledger = buildAccountLedger([
        buy(10, '100'),
        buy(4, '50', { instrumentId: OTHER_STOCK }),
        sell(3, '120'),
      ]);

      expect(holding(ledger, STOCK).quantity).toBe(7);
      expect(holding(ledger, OTHER_STOCK).quantity).toBe(4);
      expect(costBasisOf(ledger, OTHER_STOCK)).toBe('200');
    });
  });

  describe('weighted-average cost', () => {
    it('averages several purchases and keeps the average on partial sales', () => {
      const afterBuys = buildAccountLedger([buy(10, '100'), buy(30, '200')]);
      expect(costBasisOf(afterBuys)).toBe('7000');
      expect(avgCostOf(afterBuys)).toBe('175');

      // The sale price (300) must not influence the average cost.
      const afterSale = buildAccountLedger([
        buy(10, '100'),
        buy(30, '200'),
        sell(10, '300'),
      ]);
      expect(holding(afterSale).quantity).toBe(30);
      expect(costBasisOf(afterSale)).toBe('5250');
      expect(avgCostOf(afterSale)).toBe('175');

      const afterRebuy = buildAccountLedger([
        buy(10, '100'),
        buy(30, '200'),
        sell(10, '300'),
        buy(10, '250'),
      ]);
      expect(holding(afterRebuy).quantity).toBe(40);
      expect(costBasisOf(afterRebuy)).toBe('7750');
      expect(avgCostOf(afterRebuy)).toBe('193.75');
    });

    it('does not round intermediate results', () => {
      // basis 10 + 2 * 10.01 = 30.02 over 3 shares; the 2 remaining carry 20.01333...
      const ledger = buildAccountLedger([
        buy(1, '10'),
        buy(2, '10.01'),
        sell(1, '50'),
      ]);

      expect(holding(ledger).costBasis?.toDecimalPlaces(6).toFixed()).toBe(
        '20.013333',
      );
      expect(averageCost(holding(ledger))?.toDecimalPlaces(6).toFixed()).toBe(
        '10.006667',
      );
    });

    it('resets the cost basis when a position is closed and restarts it when reopened', () => {
      const closed = buildAccountLedger([buy(10, '100'), sell(10, '120')]);
      expect(holding(closed).quantity).toBe(0);
      expect(costBasisOf(closed)).toBe('0');
      expect(avgCostOf(closed)).toBeNull();

      const reopened = buildAccountLedger([
        buy(10, '100'),
        sell(10, '120'),
        buy(5, '90'),
      ]);
      expect(holding(reopened).quantity).toBe(5);
      expect(costBasisOf(reopened)).toBe('450');
      expect(avgCostOf(reopened)).toBe('90');
    });
  });

  describe('negative holdings', () => {
    it('leaves a negative quantity without cost basis when a sale exceeds the position', () => {
      const ledger = buildAccountLedger([
        cashIn(10_000),
        buy(20, '100'),
        sell(30, '110'),
      ]);

      expect(holding(ledger).quantity).toBe(-10);
      expect(costBasisOf(ledger)).toBeNull();
      expect(avgCostOf(ledger)).toBeNull();
      // 10_000 - 2000 + 3300: the sale proceeds are real even if the position is anomalous
      expect(ledger.cashBalance.toFixed()).toBe('11300');
    });

    it('goes negative when selling from a flat position and keeps going on further sales', () => {
      const ledger = buildAccountLedger([sell(5, '10'), sell(3, '10')]);

      expect(holding(ledger).quantity).toBe(-8);
      expect(costBasisOf(ledger)).toBeNull();
    });

    it('keeps the cost basis unsupported while purchases do not clear the deficit', () => {
      const ledger = buildAccountLedger([sell(10, '100'), buy(4, '90')]);

      expect(holding(ledger).quantity).toBe(-6);
      expect(costBasisOf(ledger)).toBeNull();
    });

    it('returns to a flat position with zero cost basis when a purchase exactly covers the deficit', () => {
      const ledger = buildAccountLedger([sell(10, '100'), buy(10, '90')]);

      expect(holding(ledger).quantity).toBe(0);
      expect(costBasisOf(ledger)).toBe('0');
    });

    it('restarts the cost basis from the shares held after recovering, at the purchase price', () => {
      const ledger = buildAccountLedger([
        buy(20, '100'),
        sell(30, '110'), // -10
        buy(4, '80'), // -6, still unsupported
        buy(16, '200'), // +10 -> basis = 10 * 200, not 16 * 200
      ]);

      expect(holding(ledger).quantity).toBe(10);
      expect(costBasisOf(ledger)).toBe('2000');
      expect(avgCostOf(ledger)).toBe('200');

      // From here on it behaves as a normal position again.
      const later = buildAccountLedger([
        buy(20, '100'),
        sell(30, '110'),
        buy(20, '200'),
        buy(10, '230'),
        sell(5, '300'),
      ]);
      expect(holding(later).quantity).toBe(15);
      // basis 10*200 + 10*230 = 4300 over 20 shares; selling 5 keeps 3/4
      expect(costBasisOf(later)).toBe('3225');
    });
  });

  describe('reservations', () => {
    it('reserves cash for NEW BUY orders without touching executed balances', () => {
      const ledger = buildAccountLedger([
        cashIn(10_000),
        buy(10, '150.25', {
          status: OrderStatus.NEW,
          type: OrderType.LIMIT,
        }),
        buy(2, '100', { status: OrderStatus.NEW, type: OrderType.LIMIT }),
      ]);

      expect(ledger.cashBalance.toFixed()).toBe('10000');
      expect(ledger.reservedCash.toFixed()).toBe('1702.5');
      expect(ledger.availableCash.toFixed()).toBe('8297.5');
      expect(ledger.holdings.size).toBe(0);
    });

    it('reserves shares for NEW SELL orders without touching executed balances', () => {
      const ledger = buildAccountLedger([
        buy(10, '100'),
        sell(3, '120', { status: OrderStatus.NEW, type: OrderType.LIMIT }),
        sell(2, '130', { status: OrderStatus.NEW, type: OrderType.LIMIT }),
      ]);

      expect(holding(ledger).quantity).toBe(10);
      expect(holding(ledger).reservedShares).toBe(5);
      expect(costBasisOf(ledger)).toBe('1000');
      expect(ledger.cashBalance.toFixed()).toBe('-1000');
      expect(ledger.reservedCash.toFixed()).toBe('0');
    });

    it('registers a share reservation on an instrument the user does not hold', () => {
      const ledger = buildAccountLedger([
        sell(4, '10', { status: OrderStatus.NEW }),
      ]);

      expect(holding(ledger)).toMatchObject({
        quantity: 0,
        reservedShares: 4,
      });
    });
  });

  describe('ignored statuses', () => {
    it.each([OrderStatus.CANCELLED, OrderStatus.REJECTED])(
      'ignores %s orders of every side',
      (status) => {
        const base = [cashIn(1000), buy(5, '100')];
        const noise = [
          cashIn(999),
          cashOut(999),
          buy(7, '100'),
          sell(3, '100'),
          sell(50, '100', { instrumentId: OTHER_STOCK }),
        ].map((o) => ({ ...o, status }));

        const ledger = buildAccountLedger([...base, ...noise]);
        const expected = buildAccountLedger(base);

        expect(ledger.cashBalance.toFixed()).toBe('500');
        expect(ledger.reservedCash.toFixed()).toBe('0');
        expect(holding(ledger)).toEqual(holding(expected));
        expect(ledger.holdings.has(OTHER_STOCK)).toBe(false);
      },
    );
  });

  describe('chronological processing', () => {
    it('sorts by datetime regardless of input order', () => {
      const early = buy(10, '100', { id: 7, datetime: new Date('2026-01-01') });
      const late = sell(15, '100', { id: 3, datetime: new Date('2026-01-02') });

      // Processed in input order the sale would come first; chronologically it oversells.
      const ledger = buildAccountLedger([late, early]);

      expect(holding(ledger).quantity).toBe(-5);
      expect(costBasisOf(ledger)).toBeNull();
    });

    it('breaks ties on identical timestamps by id', () => {
      const at = new Date('2026-01-01T10:00:00Z');
      const first = buy(10, '100', { id: 1, datetime: at });
      const second = sell(5, '100', { id: 2, datetime: at });

      const ledger = buildAccountLedger([second, first]);

      expect(holding(ledger).quantity).toBe(5);
      expect(costBasisOf(ledger)).toBe('500');
    });

    it('does not mutate its input', () => {
      const orders = [sell(1, '10', { id: 2 }), buy(1, '10', { id: 1 })];
      const snapshot = [...orders];

      buildAccountLedger(orders);

      expect(orders).toEqual(snapshot);
    });
  });

  describe('invalid data', () => {
    it('rejects counted trade orders without a price', () => {
      expect(() =>
        buildAccountLedger([order({ side: OrderSide.BUY, size: 1 })]),
      ).toThrow('has no price');
    });

    it.each([-1, 1.5])('rejects counted orders with size %s', (size) => {
      expect(() => buildAccountLedger([cashIn(size)])).toThrow('invalid size');
    });

    it('does not validate orders it ignores', () => {
      const ignored = {
        ...buy(1.5, '10'),
        status: OrderStatus.CANCELLED,
      };

      expect(() => buildAccountLedger([ignored])).not.toThrow();
    });
  });

  describe('account with the anomalies of the original challenge data', () => {
    const PAMP = 47;
    const LOMA = 45;
    const BMA = 31;
    const METR = 54;
    const day = (d: number, time: string) => new Date(`2023-07-${d}T${time}Z`);

    const history: LedgerOrder[] = [
      order({
        id: 1,
        side: OrderSide.CASH_IN,
        size: 1_000_000,
        price: '1',
        datetime: day(12, '12:11:20'),
      }),
      buy(50, '930', {
        id: 2,
        instrumentId: PAMP,
        datetime: day(12, '12:31:20'),
      }),
      buy(50, '920', {
        id: 3,
        instrumentId: PAMP,
        status: OrderStatus.CANCELLED,
        type: OrderType.LIMIT,
        datetime: day(12, '14:21:20'),
      }),
      sell(10, '940', {
        id: 4,
        instrumentId: PAMP,
        datetime: day(12, '14:51:20'),
      }),
      buy(50, '710', {
        id: 5,
        instrumentId: LOMA,
        status: OrderStatus.NEW,
        type: OrderType.LIMIT,
        datetime: day(12, '15:14:20'),
      }),
      sell(100, '950', {
        id: 6,
        instrumentId: PAMP,
        status: OrderStatus.REJECTED,
        datetime: day(12, '16:11:20'),
      }),
      buy(60, '1500', {
        id: 7,
        instrumentId: BMA,
        status: OrderStatus.NEW,
        type: OrderType.LIMIT,
        datetime: day(13, '11:13:20'),
      }),
      order({
        id: 8,
        side: OrderSide.CASH_OUT,
        size: 100_000,
        price: '1',
        datetime: day(13, '12:31:20'),
      }),
      buy(20, '1540', {
        id: 9,
        instrumentId: BMA,
        type: OrderType.LIMIT,
        datetime: day(13, '12:51:20'),
      }),
      buy(500, '250', {
        id: 10,
        instrumentId: METR,
        datetime: day(13, '14:11:20'),
      }),
      sell(30, '1530', {
        id: 11,
        instrumentId: BMA,
        datetime: day(13, '15:13:20'),
      }),
    ];

    it('reproduces cash, reservations and holdings', () => {
      const ledger = buildAccountLedger(history);

      expect(ledger.cashBalance.toFixed()).toBe('753000');
      expect(ledger.reservedCash.toFixed()).toBe('125500');
      expect(ledger.availableCash.toFixed()).toBe('627500');

      expect(holding(ledger, PAMP).quantity).toBe(40);
      expect(avgCostOf(ledger, PAMP)).toBe('930');

      expect(holding(ledger, METR).quantity).toBe(500);
      expect(avgCostOf(ledger, METR)).toBe('250');

      expect(holding(ledger, BMA).quantity).toBe(-10);
      expect(avgCostOf(ledger, BMA)).toBeNull();

      expect(ledger.holdings.has(LOMA)).toBe(false);
    });
  });
});
