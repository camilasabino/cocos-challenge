import Decimal from 'decimal.js';
import { parseDecimal } from '../../common/decimal';
import { LatestPrice } from '../../market-data/latest-price';
import { AccountLedger, Holding } from './account-ledger';
import {
  InstrumentInfo,
  openPositionInstrumentIds,
  valuePortfolio,
} from './portfolio-valuation';

const d = parseDecimal;

function holding(
  quantity: number,
  costBasis: string | null,
  reservedShares = 0,
): Holding {
  return {
    quantity,
    costBasis: costBasis === null ? null : d(costBasis),
    reservedShares,
  };
}

function ledgerOf(
  holdings: Record<number, Holding>,
  cashBalance = '1000.00',
  reservedCash = '0',
): AccountLedger {
  return {
    cashBalance: d(cashBalance),
    reservedCash: d(reservedCash),
    availableCash: d(cashBalance).minus(d(reservedCash)),
    holdings: new Map(
      Object.entries(holdings).map(([id, value]) => [Number(id), value]),
    ),
  };
}

function instrumentsOf(
  ...infos: [id: number, ticker: string | null][]
): Map<number, InstrumentInfo> {
  return new Map(
    infos.map(([id, ticker]) => [id, { id, ticker, name: `Name ${id}` }]),
  );
}

function price(close: string, previousClose: string | null): LatestPrice {
  return {
    close: d(close),
    previousClose: previousClose === null ? null : d(previousClose),
  };
}

const text = (value: Decimal | null): string | null =>
  value === null ? null : value.toString();

describe('valuePortfolio', () => {
  it('values a long position at the last price against its weighted-average cost', () => {
    const portfolio = valuePortfolio({
      userId: 7,
      ledger: ledgerOf({ 1: holding(40, '37200') }, '10000.00', '500.00'),
      instruments: instrumentsOf([1, 'PAMP']),
      prices: new Map([[1, price('925.85', '921.80')]]),
    });

    expect(portfolio.userId).toBe(7);
    expect(portfolio.valuationComplete).toBe(true);
    expect(portfolio.unpricedInstrumentIds).toEqual([]);
    expect(text(portfolio.cashBalance)).toBe('10000');
    expect(text(portfolio.availableCash)).toBe('9500');
    // Total uses cash balance, not available cash (reservations are not spent money).
    expect(text(portfolio.totalAccountValue)).toBe('47034');

    const [position] = portfolio.positions;
    expect(position).toMatchObject({
      instrumentId: 1,
      ticker: 'PAMP',
      name: 'Name 1',
      quantity: 40,
    });
    expect(text(position.lastPrice)).toBe('925.85');
    expect(text(position.marketValue)).toBe('37034');
    expect(text(position.averageCost)).toBe('930');
    // (37034 - 37200) / 37200 * 100, unrounded.
    expect(position.totalReturnPercent?.toDecimalPlaces(6).toString()).toBe(
      '-0.446237',
    );
    // (925.85 - 921.80) / 921.80 * 100
    expect(
      position.dailyPriceChangePercent?.toDecimalPlaces(6).toString(),
    ).toBe('0.439358');
  });

  it('computes the return from the exact cost basis, not from a rounded average cost', () => {
    // basis 100 / 3 shares: average cost 33.333...; value 3 * 40 = 120.
    const [position] = valuePortfolio({
      userId: 1,
      ledger: ledgerOf({ 1: holding(3, '100') }),
      instruments: instrumentsOf([1, 'AAA']),
      prices: new Map([[1, price('40.00', '40.00')]]),
    }).positions;

    expect(position.totalReturnPercent?.toString()).toBe('20');
  });

  it('lists a negative holding with a negative market value and no cost-based figures', () => {
    const portfolio = valuePortfolio({
      userId: 1,
      ledger: ledgerOf({ 1: holding(-10, null) }, '100000.00'),
      instruments: instrumentsOf([1, 'BMA']),
      prices: new Map([[1, price('1502.80', '1520.30')]]),
    });

    const [position] = portfolio.positions;
    expect(position.quantity).toBe(-10);
    expect(text(position.marketValue)).toBe('-15028');
    expect(position.averageCost).toBeNull();
    expect(position.totalReturnPercent).toBeNull();
    // The daily figure is the instrument's price change, independent of the sign of the position.
    expect(position.dailyPriceChangePercent?.isNegative()).toBe(true);
    expect(text(portfolio.totalAccountValue)).toBe('84972');
  });

  it('reports no total and flags unpriced positions instead of a partial valuation', () => {
    const portfolio = valuePortfolio({
      userId: 1,
      ledger: ledgerOf({ 1: holding(10, '1000'), 2: holding(5, '50') }),
      instruments: instrumentsOf([1, 'AAA'], [2, 'BBB']),
      prices: new Map([[1, price('120.00', '100.00')]]),
    });

    expect(portfolio.valuationComplete).toBe(false);
    expect(portfolio.totalAccountValue).toBeNull();
    expect(portfolio.unpricedInstrumentIds).toEqual([2]);

    const [priced, unpriced] = portfolio.positions;
    expect(text(priced.marketValue)).toBe('1200');
    expect(unpriced).toMatchObject({
      instrumentId: 2,
      quantity: 5,
      lastPrice: null,
      marketValue: null,
      totalReturnPercent: null,
      dailyPriceChangePercent: null,
    });
    // Cost-based information does not depend on the price.
    expect(text(unpriced.averageCost)).toBe('10');
  });

  it.each([
    ['null', null],
    ['zero', '0.00'],
  ])(
    'has no daily change when previousClose is %s',
    (_label, previousClose) => {
      const [position] = valuePortfolio({
        userId: 1,
        ledger: ledgerOf({ 1: holding(1, '10') }),
        instruments: instrumentsOf([1, 'AAA']),
        prices: new Map([[1, price('10.00', previousClose)]]),
      }).positions;

      expect(position.dailyPriceChangePercent).toBeNull();
      expect(text(position.marketValue)).toBe('10');
    },
  );

  it('has no return when the cost basis is zero', () => {
    const [position] = valuePortfolio({
      userId: 1,
      ledger: ledgerOf({ 1: holding(5, '0') }),
      instruments: instrumentsOf([1, 'AAA']),
      prices: new Map([[1, price('10.00', '10.00')]]),
    }).positions;

    expect(position.totalReturnPercent).toBeNull();
    expect(text(position.averageCost)).toBe('0');
  });

  it('is complete with a zero total for an empty account', () => {
    const portfolio = valuePortfolio({
      userId: 1,
      ledger: ledgerOf({}, '0'),
      instruments: new Map(),
      prices: new Map(),
    });

    expect(portfolio).toMatchObject({
      valuationComplete: true,
      unpricedInstrumentIds: [],
      positions: [],
    });
    expect(text(portfolio.totalAccountValue)).toBe('0');
  });

  it('omits closed and reservation-only holdings', () => {
    const ledger = ledgerOf({
      1: holding(0, '0'),
      2: holding(0, '0', 5),
      3: holding(1, '10'),
    });

    expect(openPositionInstrumentIds(ledger)).toEqual([3]);
    const portfolio = valuePortfolio({
      userId: 1,
      ledger,
      instruments: instrumentsOf([3, 'CCC']),
      prices: new Map([[3, price('10.00', '10.00')]]),
    });
    expect(portfolio.positions.map((p) => p.instrumentId)).toEqual([3]);
  });

  it('orders positions by ticker, nulls last, ties by instrument id', () => {
    const portfolio = valuePortfolio({
      userId: 1,
      ledger: ledgerOf({
        1: holding(1, '1'),
        2: holding(1, '1'),
        3: holding(1, '1'),
        4: holding(1, '1'),
        5: holding(1, '1'),
      }),
      instruments: instrumentsOf(
        [1, 'ZZZ'],
        [2, null],
        [3, 'AAA'],
        [5, 'AAA'],
        [4, 'MMM'],
      ),
      prices: new Map(),
    });

    expect(portfolio.positions.map((p) => p.instrumentId)).toEqual([
      3, 5, 4, 1, 2,
    ]);
    // Unpriced ids follow the position order.
    expect(portfolio.unpricedInstrumentIds).toEqual([3, 5, 4, 1, 2]);
  });

  it('fails loudly if a holding has no instrument', () => {
    expect(() =>
      valuePortfolio({
        userId: 1,
        ledger: ledgerOf({ 9: holding(1, '1') }),
        instruments: new Map(),
        prices: new Map(),
      }),
    ).toThrow(/Instrument 9/);
  });
});
