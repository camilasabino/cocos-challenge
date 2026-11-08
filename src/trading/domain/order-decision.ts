import Decimal from 'decimal.js';
import { AccountLedger } from './account-ledger';
import {
  OrderSide,
  OrderStatus,
  OrderType,
  RejectionReason,
} from './order.types';

export interface OrderIntent {
  side: OrderSide.BUY | OrderSide.SELL;
  type: OrderType;
  instrumentId: number;
  quantity: number;
  price: Decimal;
}

export interface OrderDecision {
  status: OrderStatus.FILLED | OrderStatus.NEW | OrderStatus.REJECTED;
  rejectionReason: RejectionReason | null;
}

/**
 * Insufficient cash or shares is not an error: the order is persisted as
 * REJECTED. Available shares exclude NEW SELL reservations, and a position that
 * is not held or is negative (historical data) has none, so a SELL can never
 * create or deepen a short. Nothing here moves a NEW order to FILLED.
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
