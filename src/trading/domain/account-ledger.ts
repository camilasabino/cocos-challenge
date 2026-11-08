import Decimal from 'decimal.js';
import { ZERO } from '../../common/decimal';
import { OrderSide, OrderStatus, OrderType } from './order.types';

/** One row of `orders`, already converted to domain types by the persistence layer. */
export interface LedgerOrder {
  id: number;
  instrumentId: number;
  side: OrderSide;
  /** Not used in calculations: a FILLED LIMIT order counts like a FILLED MARKET one. */
  type: OrderType;
  status: OrderStatus;
  /** Shares for BUY/SELL; ARS amount for CASH_IN/CASH_OUT. */
  size: number;
  /** Unit price. Ignored for cash orders, so it may be null there. */
  price: Decimal | null;
  datetime: Date;
}

export interface Holding {
  /** FILLED shares: buys minus sells. Negative only when historical data oversold the position. */
  quantity: number;
  /**
   * Weighted-average cost basis of the open position. Zero when flat; null when
   * `quantity < 0` (an oversold position has no supported cost basis).
   */
  costBasis: Decimal | null;
  /** Shares committed to NEW SELL orders. */
  reservedShares: number;
}

export interface AccountLedger {
  /** Executed cash: FILLED movements only. */
  cashBalance: Decimal;
  /** Cash committed to NEW BUY orders. */
  reservedCash: Decimal;
  /** `cashBalance - reservedCash`. */
  availableCash: Decimal;
  /**
   * Instruments touched by a FILLED BUY/SELL or a NEW SELL. Closed positions
   * are kept with `quantity: 0`; consumers decide whether to list them.
   */
  holdings: Map<number, Holding>;
}

/**
 * Folds a user's orders into cash balance, reservations and holdings.
 *
 * - FILLED: moves cash and shares. Processed chronologically (`datetime`, then
 *   `id`) because the cost basis depends on the order of purchases and sales.
 * - NEW BUY reserves `size * price` cash; NEW SELL reserves `size` shares.
 *   NEW cash transfers reserve nothing.
 * - CANCELLED and REJECTED are ignored.
 *
 * The input is not mutated and need not be sorted. Throws if a counted order
 * carries data that cannot be valued (non-integer/negative size, missing price).
 */
export function buildAccountLedger(
  orders: readonly LedgerOrder[],
): AccountLedger {
  let cashBalance = ZERO;
  let reservedCash = ZERO;
  const holdings = new Map<number, Holding>();

  const holdingOf = (instrumentId: number): Holding => {
    let holding = holdings.get(instrumentId);
    if (!holding) {
      holding = { quantity: 0, costBasis: ZERO, reservedShares: 0 };
      holdings.set(instrumentId, holding);
    }
    return holding;
  };

  const chronological = [...orders].sort(
    (a, b) => a.datetime.getTime() - b.datetime.getTime() || a.id - b.id,
  );

  for (const order of chronological) {
    if (order.status === OrderStatus.FILLED) {
      assertValidSize(order);
      switch (order.side) {
        case OrderSide.CASH_IN:
          cashBalance = cashBalance.plus(order.size);
          break;
        case OrderSide.CASH_OUT:
          cashBalance = cashBalance.minus(order.size);
          break;
        case OrderSide.BUY: {
          const total = totalOf(order);
          cashBalance = cashBalance.minus(total);
          applyBuy(
            holdingOf(order.instrumentId),
            order.size,
            requirePrice(order),
          );
          break;
        }
        case OrderSide.SELL: {
          const total = totalOf(order);
          cashBalance = cashBalance.plus(total);
          applySell(holdingOf(order.instrumentId), order.size);
          break;
        }
      }
    } else if (order.status === OrderStatus.NEW) {
      assertValidSize(order);
      if (order.side === OrderSide.BUY) {
        reservedCash = reservedCash.plus(totalOf(order));
      } else if (order.side === OrderSide.SELL) {
        holdingOf(order.instrumentId).reservedShares += order.size;
      }
    }
  }

  return {
    cashBalance,
    reservedCash,
    availableCash: cashBalance.minus(reservedCash),
    holdings,
  };
}

/** `costBasis / quantity`; null when there is no supported cost basis or the position is not long. */
export function averageCost(holding: Holding): Decimal | null {
  if (holding.costBasis === null || holding.quantity <= 0) return null;
  return holding.costBasis.div(holding.quantity);
}

function applyBuy(holding: Holding, size: number, price: Decimal): void {
  const { quantity, costBasis } = holding;
  const newQuantity = quantity + size;

  if (costBasis !== null) {
    holding.costBasis = costBasis.plus(price.mul(size));
  } else if (newQuantity > 0) {
    // Recovery from an oversold position: only the shares actually held after
    // this purchase are valued, at this purchase's price.
    holding.costBasis = price.mul(newQuantity);
  } else if (newQuantity === 0) {
    holding.costBasis = ZERO;
  }
  // Still negative: cost basis stays unsupported (null).
  holding.quantity = newQuantity;
}

function applySell(holding: Holding, size: number): void {
  const { quantity, costBasis } = holding;

  if (costBasis !== null && size <= quantity) {
    // The sold shares leave at the current average cost, which therefore does not change.
    holding.costBasis =
      size === quantity ? ZERO : costBasis.mul(quantity - size).div(quantity);
  } else {
    holding.costBasis = null;
  }
  holding.quantity = quantity - size;
}

function totalOf(order: LedgerOrder): Decimal {
  return requirePrice(order).mul(order.size);
}

function requirePrice(order: LedgerOrder): Decimal {
  if (order.price === null) {
    throw new Error(`Order ${order.id} (${order.side}) has no price`);
  }
  return order.price;
}

function assertValidSize(order: LedgerOrder): void {
  if (!Number.isSafeInteger(order.size) || order.size < 0) {
    throw new Error(`Order ${order.id} has an invalid size: ${order.size}`);
  }
}
