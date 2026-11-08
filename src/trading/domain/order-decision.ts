import Decimal from 'decimal.js';
import { AccountLedger } from './account-ledger';
import {
  OrderSide,
  OrderStatus,
  OrderType,
  RejectionReason,
} from './order.types';

/** A priced, sized order the user wants to place. Only BUY and SELL can be placed. */
export interface OrderIntent {
  side: OrderSide.BUY | OrderSide.SELL;
  type: OrderType;
  instrumentId: number;
  /** Whole shares, already resolved and bounded by the caller. */
  quantity: number;
  /** Execution price (MARKET: latest close) or limit price (LIMIT). */
  price: Decimal;
}

export interface OrderDecision {
  status: OrderStatus.FILLED | OrderStatus.NEW | OrderStatus.REJECTED;
  /** Response-only explanation; null unless the order is REJECTED. */
  rejectionReason: RejectionReason | null;
}

/**
 * Decides the status a new order is persisted with, given the account state.
 * Insufficient cash or shares is not an error: the order is still persisted,
 * as REJECTED.
 *
 * - BUY needs `quantity * price` of available cash (cash minus NEW BUY reservations).
 * - SELL needs `quantity` available shares (held minus NEW SELL reservations).
 *   An instrument that is not held, or is held negative by historical data,
 *   has no available shares, so a new SELL can never create or deepen a short.
 * - Accepted MARKET orders execute immediately (FILLED); accepted LIMIT orders
 *   wait (NEW). Nothing here ever moves a NEW order to FILLED.
 */
export function decideOrder(
  ledger: AccountLedger,
  intent: OrderIntent,
): OrderDecision {
  if (intent.side === OrderSide.BUY) {
    const total = intent.price.mul(intent.quantity);
    if (total.greaterThan(ledger.availableCash)) {
      return rejected(RejectionReason.INSUFFICIENT_FUNDS);
    }
  } else {
    const holding = ledger.holdings.get(intent.instrumentId);
    const availableShares = holding
      ? holding.quantity - holding.reservedShares
      : 0;
    if (intent.quantity > availableShares) {
      return rejected(RejectionReason.INSUFFICIENT_SHARES);
    }
  }

  return {
    status:
      intent.type === OrderType.MARKET ? OrderStatus.FILLED : OrderStatus.NEW,
    rejectionReason: null,
  };
}

function rejected(reason: RejectionReason): OrderDecision {
  return { status: OrderStatus.REJECTED, rejectionReason: reason };
}
