import Decimal from 'decimal.js';
import { LatestPrice } from '../../market-data/latest-price';
import { AccountLedger, Holding, averageCost } from './account-ledger';

/** The instrument attributes a position needs. */
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
  /** Latest close; null when the instrument has no usable price. */
  lastPrice: Decimal | null;
  /** Null when the instrument has no usable price. */
  marketValue: Decimal | null;
  /** Weighted-average cost; independent of price, null without a supported cost basis. */
  averageCost: Decimal | null;
  /**
   * Unrealized return of the current position on its cost basis, in percent.
   * Null without a price or without a supported, non-zero cost basis.
   */
  totalReturnPercent: Decimal | null;
  /**
   * Instrument price change `close` vs `previousClose`, in percent (not an
   * investment return). Null without a price or a non-zero previous close.
   */
  dailyPriceChangePercent: Decimal | null;
}

export interface Portfolio {
  userId: number;
  /** Null whenever `valuationComplete` is false: a partial total is never reported. */
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
  /** Must contain every instrument with a non-zero holding. */
  instruments: ReadonlyMap<number, InstrumentInfo>;
  /** Instruments without a usable price are simply absent. */
  prices: ReadonlyMap<number, LatestPrice>;
}

/** Ids of the instruments the account holds (quantity ≠ 0), i.e. those to be listed and valued. */
export function openPositionInstrumentIds(ledger: AccountLedger): number[] {
  return [...ledger.holdings]
    .filter(([, holding]) => holding.quantity !== 0)
    .map(([instrumentId]) => instrumentId);
}

/**
 * Values an account from its ledger at the latest prices. Pure: no I/O, no rounding —
 * results keep full Decimal precision and are rounded only when serialized.
 * Positions are ordered by ticker (code-unit order, nulls last), then id.
 */
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

  // Return needs a supported, non-zero cost basis, which only long positions have.
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

/** `(to - from) / from * 100`; null when `from` is zero. */
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
