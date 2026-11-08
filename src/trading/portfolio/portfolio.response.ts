import Decimal from 'decimal.js';
import { formatMoney, formatPercent } from '../../common/decimal';
import { Portfolio, Position } from '../domain/portfolio-valuation';

export interface PositionResponse {
  instrumentId: number;
  ticker: string | null;
  name: string | null;
  quantity: number;
  lastPrice: string | null;
  marketValue: string | null;
  averageCost: string | null;
  totalReturnPercent: string | null;
  dailyPriceChangePercent: string | null;
}

export interface PortfolioResponse {
  userId: number;
  totalAccountValue: string | null;
  cashBalance: string;
  availableCash: string;
  valuationComplete: boolean;
  unpricedInstrumentIds: number[];
  positions: PositionResponse[];
}

/** The only place Decimals are rounded (HALF_UP, 2 decimals); never converted to JS numbers. */
export function toPortfolioResponse(portfolio: Portfolio): PortfolioResponse {
  return {
    userId: portfolio.userId,
    totalAccountValue: nullable(portfolio.totalAccountValue, formatMoney),
    cashBalance: formatMoney(portfolio.cashBalance),
    availableCash: formatMoney(portfolio.availableCash),
    valuationComplete: portfolio.valuationComplete,
    unpricedInstrumentIds: portfolio.unpricedInstrumentIds,
    positions: portfolio.positions.map(toPositionResponse),
  };
}

function toPositionResponse(position: Position): PositionResponse {
  return {
    instrumentId: position.instrumentId,
    ticker: position.ticker,
    name: position.name,
    quantity: position.quantity,
    lastPrice: nullable(position.lastPrice, formatMoney),
    marketValue: nullable(position.marketValue, formatMoney),
    averageCost: nullable(position.averageCost, formatMoney),
    totalReturnPercent: nullable(position.totalReturnPercent, formatPercent),
    dailyPriceChangePercent: nullable(
      position.dailyPriceChangePercent,
      formatPercent,
    ),
  };
}

function nullable(
  value: Decimal | null,
  format: (value: Decimal) => string,
): string | null {
  return value === null ? null : format(value);
}
