import Decimal from 'decimal.js';
import { LatestPrice } from '../../market-data/latest-price';
import { AccountLedger, Holding, averageCost } from './account-ledger';

export interface InstrumentInfo {
  id: number;
  ticker: string | null;
  name: string | null;
}

export interface Position {
  instrumentId: number;
  ticker: string | null;
  name: string | null;
  /** Negative only for oversold historical data, which is never corrected. */
  quantity: number;
  lastPrice: Decimal | null;
  marketValue: Decimal | null;
  averageCost: Decimal | null;
  totalReturnPercent: Decimal | null;
  /** Instrument price change vs previous close, not the investor's return. */
  dailyPriceChangePercent: Decimal | null;
}

export interface Portfolio {
  userId: number;
  /** Null unless `valuationComplete`: a partial total is never reported. */
  totalAccountValue: Decimal | null;
  cashBalance: Decimal;
  availableCash: Decimal;
  valuationComplete: boolean;
  unpricedInstrumentIds: number[];
  positions: Position[];
}

export interface PortfolioInput {
  userId: number;
  ledger: AccountLedger;
  instruments: ReadonlyMap<number, InstrumentInfo>;
  prices: ReadonlyMap<number, LatestPrice>;
}

export function openPositionInstrumentIds(ledger: AccountLedger): number[] {
  return [...ledger.holdings]
    .filter(([, holding]) => holding.quantity !== 0)
    .map(([instrumentId]) => instrumentId);
}

/** No rounding here: Decimals are rounded only when serialized. */
export function valuePortfolio(input: PortfolioInput): Portfolio {
  const { userId, ledger, instruments, prices } = input;

  const positions = openPositionInstrumentIds(ledger)
    .map((instrumentId) => {
      const instrument = instruments.get(instrumentId);
      if (!instrument) {
        throw new Error(`Instrument ${instrumentId} not found for a holding`);
      }
      const holding = ledger.holdings.get(instrumentId) as Holding;
      return valuePosition(instrument, holding, prices.get(instrumentId));
    })
    .sort(byTicker);

  const unpricedInstrumentIds = positions
    .filter((position) => position.marketValue === null)
    .map((position) => position.instrumentId);
  const valuationComplete = unpricedInstrumentIds.length === 0;

  const totalAccountValue = valuationComplete
    ? positions.reduce(
        (total, position) => total.plus(position.marketValue as Decimal),
        ledger.cashBalance,
      )
    : null;

  return {
    userId,
    totalAccountValue,
    cashBalance: ledger.cashBalance,
    availableCash: ledger.availableCash,
    valuationComplete,
    unpricedInstrumentIds,
    positions,
  };
}

function valuePosition(
  instrument: InstrumentInfo,
  holding: Holding,
  price: LatestPrice | undefined,
): Position {
  const marketValue = price ? price.close.mul(holding.quantity) : null;

  // Only long positions have a supported cost basis.
  const costBasis = holding.quantity > 0 ? holding.costBasis : null;
  const totalReturnPercent =
    marketValue !== null && costBasis !== null
      ? percentChange(costBasis, marketValue)
      : null;

  const dailyPriceChangePercent =
    price && price.previousClose !== null
      ? percentChange(price.previousClose, price.close)
      : null;

  return {
    instrumentId: instrument.id,
    ticker: instrument.ticker,
    name: instrument.name,
    quantity: holding.quantity,
    lastPrice: price?.close ?? null,
    marketValue,
    averageCost: averageCost(holding),
    totalReturnPercent,
    dailyPriceChangePercent,
  };
}

function percentChange(from: Decimal, to: Decimal): Decimal | null {
  if (from.isZero()) return null;
  return to.minus(from).div(from).mul(100);
}

function byTicker(a: Position, b: Position): number {
  if (a.ticker !== b.ticker) {
    if (a.ticker === null) return 1;
    if (b.ticker === null) return -1;
    return a.ticker < b.ticker ? -1 : 1;
  }
  return a.instrumentId - b.instrumentId;
}
