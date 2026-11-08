import { ApiProperty } from '@nestjs/swagger';
import Decimal from 'decimal.js';
import { formatMoney, formatPercent } from '../../common/decimal';
import { Portfolio, Position } from '../domain/portfolio-valuation';

const MONEY = '^-?\\d+\\.\\d{2}$';

export class PositionResponse {
  @ApiProperty({ example: 2 })
  instrumentId!: number;

  @ApiProperty({ type: String, nullable: true, example: 'NRTE' })
  ticker!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Norte Energía S.A.' })
  name!: string | null;

  @ApiProperty({
    description:
      'Net shares from FILLED orders (BUY minus SELL). Negative only for a historical oversold position present in the data; this API never creates one.',
    example: 90,
  })
  quantity!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: MONEY,
    description:
      'Latest `close` from market data. `null` when the instrument has no usable price.',
    example: '1050.00',
  })
  lastPrice!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: MONEY,
    description:
      '`quantity × lastPrice` in ARS (negative for a negative position). `null` without a price.',
    example: '94500.00',
  })
  marketValue!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: MONEY,
    description:
      'Weighted-average purchase cost per share. `null` when the position is not long or its cost basis is unsupported (historical oversold position).',
    example: '1003.33',
  })
  averageCost!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: MONEY,
    description:
      'Total (unrealized) return of the position, in percent: `(marketValue − costBasis) / costBasis × 100`. `null` without a price or a supported cost basis.',
    example: '4.65',
  })
  totalReturnPercent!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: MONEY,
    description:
      'Instrument price change in percent, `(close − previousClose) / previousClose × 100`. It is the change of the instrument price, not of the investment. `null` when `previousClose` is missing or zero.',
    example: '2.94',
  })
  dailyPriceChangePercent!: string | null;
}

export class PortfolioResponse {
  @ApiProperty({ example: 1 })
  userId!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: MONEY,
    description:
      '`cashBalance` plus the market value of all positions, in ARS. `null` when `valuationComplete` is `false`: a partial total is never returned as if it were complete.',
    example: '1857690.00',
  })
  totalAccountValue!: string | null;

  @ApiProperty({
    pattern: MONEY,
    description:
      'Cash from FILLED orders: CASH_IN − CASH_OUT − BUY + SELL (size × price), in ARS.',
    example: '1609400.00',
  })
  cashBalance!: string;

  @ApiProperty({
    pattern: MONEY,
    description:
      '`cashBalance` minus the cash reserved by open (`NEW`) BUY orders. This is the amount available to trade.',
    example: '1585400.00',
  })
  availableCash!: string;

  @ApiProperty({
    description:
      '`false` when at least one non-zero position has no market price.',
    example: true,
  })
  valuationComplete!: boolean;

  @ApiProperty({
    type: [Number],
    description:
      'Instruments held without a usable price; empty when complete.',
    example: [],
  })
  unpricedInstrumentIds!: number[];

  @ApiProperty({
    type: [PositionResponse],
    description:
      'Non-zero positions ordered by ticker. Closed positions are omitted.',
  })
  positions!: PositionResponse[];
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
