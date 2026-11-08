import { parseDecimal } from '../common/decimal';
import { Portfolio } from './portfolio-valuation';
import { toPortfolioResponse } from './portfolio.response';

const d = parseDecimal;

function portfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    userId: 1,
    totalAccountValue: d('100.005'),
    cashBalance: d('0.005'),
    availableCash: d('-0.005'),
    valuationComplete: true,
    unpricedInstrumentIds: [],
    positions: [],
    ...overrides,
  };
}

describe('toPortfolioResponse', () => {
  it('serializes money and percentages as 2-decimal strings rounded HALF_UP (away from zero)', () => {
    const response = toPortfolioResponse(
      portfolio({
        positions: [
          {
            instrumentId: 4,
            ticker: 'AAA',
            name: 'Alpha',
            quantity: 3,
            lastPrice: d('1.005'),
            marketValue: d('-2.675'),
            averageCost: d('33.3333333333'),
            totalReturnPercent: d('-0.445'),
            dailyPriceChangePercent: d('0.0049'),
          },
        ],
      }),
    );

    expect(response).toEqual({
      userId: 1,
      totalAccountValue: '100.01',
      cashBalance: '0.01',
      availableCash: '-0.01',
      valuationComplete: true,
      unpricedInstrumentIds: [],
      positions: [
        {
          instrumentId: 4,
          ticker: 'AAA',
          name: 'Alpha',
          quantity: 3,
          lastPrice: '1.01',
          marketValue: '-2.68',
          averageCost: '33.33',
          totalReturnPercent: '-0.45',
          dailyPriceChangePercent: '0.00',
        },
      ],
    });
  });

  it('keeps nulls as null instead of formatting them', () => {
    const response = toPortfolioResponse(
      portfolio({
        totalAccountValue: null,
        valuationComplete: false,
        unpricedInstrumentIds: [9],
        positions: [
          {
            instrumentId: 9,
            ticker: null,
            name: null,
            quantity: -2,
            lastPrice: null,
            marketValue: null,
            averageCost: null,
            totalReturnPercent: null,
            dailyPriceChangePercent: null,
          },
        ],
      }),
    );

    expect(response.totalAccountValue).toBeNull();
    expect(response.positions[0]).toEqual({
      instrumentId: 9,
      ticker: null,
      name: null,
      quantity: -2,
      lastPrice: null,
      marketValue: null,
      averageCost: null,
      totalReturnPercent: null,
      dailyPriceChangePercent: null,
    });
  });

  it('serializes a zero total as "0.00", not null', () => {
    expect(
      toPortfolioResponse(portfolio({ totalAccountValue: d('0') }))
        .totalAccountValue,
    ).toBe('0.00');
  });
});
