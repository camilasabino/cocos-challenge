import { parseDecimal } from '../../common/decimal';
import { LedgerOrder, buildAccountLedger } from './account-ledger';
import { OrderIntent, decideOrder } from './order-decision';
import {
  OrderSide,
  OrderStatus,
  OrderType,
  RejectionReason,
} from './order.types';

const STOCK = 10;
const CASH = 1;

let nextId = 1;
function order(
  side: OrderSide,
  size: number,
  price: string,
  rest: Partial<LedgerOrder> = {},
): LedgerOrder {
  const id = nextId++;
  const isCash = side === OrderSide.CASH_IN || side === OrderSide.CASH_OUT;
  return {
    id,
    instrumentId: isCash ? CASH : STOCK,
    side,
    type: OrderType.MARKET,
    status: OrderStatus.FILLED,
    size,
    price: parseDecimal(price),
    datetime: new Date(Date.UTC(2026, 0, 1, 0, 0, id)),
    ...rest,
  };
}

const ledgerOf = (...orders: LedgerOrder[]) => buildAccountLedger(orders);

function intent(
  side: OrderSide.BUY | OrderSide.SELL,
  quantity: number,
  price: string,
  type = OrderType.MARKET,
): OrderIntent {
  return {
    side,
    type,
    instrumentId: STOCK,
    quantity,
    price: parseDecimal(price),
  };
}

describe('decideOrder', () => {
  describe('BUY', () => {
    const cash = order(OrderSide.CASH_IN, 1000, '1');

    it('fills a MARKET buy that the available cash covers, down to the last cent', () => {
      expect(
        decideOrder(ledgerOf(cash), intent(OrderSide.BUY, 10, '100.00')),
      ).toEqual({ status: OrderStatus.FILLED, rejectionReason: null });
    });

    it('rejects a buy that exceeds available cash by one cent', () => {
      expect(
        decideOrder(ledgerOf(cash), intent(OrderSide.BUY, 1000, '1.01')),
      ).toEqual({
        status: OrderStatus.REJECTED,
        rejectionReason: RejectionReason.INSUFFICIENT_FUNDS,
      });
    });

    it('rejects any buy on an empty account', () => {
      expect(
        decideOrder(ledgerOf(), intent(OrderSide.BUY, 1, '0.01')),
      ).toMatchObject({ rejectionReason: RejectionReason.INSUFFICIENT_FUNDS });
    });

    it('leaves an accepted LIMIT buy as NEW', () => {
      expect(
        decideOrder(
          ledgerOf(cash),
          intent(OrderSide.BUY, 10, '100.00', OrderType.LIMIT),
        ),
      ).toEqual({ status: OrderStatus.NEW, rejectionReason: null });
    });

    it('counts NEW BUY reservations against available cash', () => {
      const reserved = order(OrderSide.BUY, 6, '100.00', {
        type: OrderType.LIMIT,
        status: OrderStatus.NEW,
      });

      expect(
        decideOrder(
          ledgerOf(cash, reserved),
          intent(OrderSide.BUY, 5, '100.00'),
        ),
      ).toMatchObject({ rejectionReason: RejectionReason.INSUFFICIENT_FUNDS });
      expect(
        decideOrder(
          ledgerOf(cash, reserved),
          intent(OrderSide.BUY, 4, '100.00'),
        ),
      ).toMatchObject({ status: OrderStatus.FILLED });
    });

    it('does not let REJECTED or CANCELLED orders reserve cash', () => {
      const rejected = order(OrderSide.BUY, 10, '100.00', {
        status: OrderStatus.REJECTED,
      });
      const cancelled = order(OrderSide.BUY, 10, '100.00', {
        type: OrderType.LIMIT,
        status: OrderStatus.CANCELLED,
      });

      expect(
        decideOrder(
          ledgerOf(cash, rejected, cancelled),
          intent(OrderSide.BUY, 10, '100.00'),
        ),
      ).toMatchObject({ status: OrderStatus.FILLED });
    });

    it('computes the total exactly (no float error)', () => {
      const exact = ledgerOf(order(OrderSide.CASH_IN, 3, '1'));
      // 0.1 * 30 is 3.0000000000000004 in binary floating point.
      expect(
        decideOrder(exact, intent(OrderSide.BUY, 30, '0.10')),
      ).toMatchObject({ status: OrderStatus.FILLED });
    });
  });

  describe('SELL', () => {
    const holdings = [
      order(OrderSide.CASH_IN, 100000, '1'),
      order(OrderSide.BUY, 10, '100.00'),
    ];

    it('fills a MARKET sell of the whole holding', () => {
      expect(
        decideOrder(ledgerOf(...holdings), intent(OrderSide.SELL, 10, '120')),
      ).toEqual({ status: OrderStatus.FILLED, rejectionReason: null });
    });

    it('rejects selling one share more than held', () => {
      expect(
        decideOrder(ledgerOf(...holdings), intent(OrderSide.SELL, 11, '120')),
      ).toEqual({
        status: OrderStatus.REJECTED,
        rejectionReason: RejectionReason.INSUFFICIENT_SHARES,
      });
    });

    it('rejects a sell of an instrument that is not held', () => {
      expect(
        decideOrder(ledgerOf(), intent(OrderSide.SELL, 1, '120')),
      ).toMatchObject({
        rejectionReason: RejectionReason.INSUFFICIENT_SHARES,
      });
    });

    it('leaves an accepted LIMIT sell as NEW without touching the holding', () => {
      const ledger = ledgerOf(...holdings);

      expect(
        decideOrder(ledger, intent(OrderSide.SELL, 10, '150', OrderType.LIMIT)),
      ).toEqual({ status: OrderStatus.NEW, rejectionReason: null });
      expect(ledger.holdings.get(STOCK)?.quantity).toBe(10);
    });

    it('counts NEW SELL reservations against available shares', () => {
      const reserved = order(OrderSide.SELL, 7, '150.00', {
        type: OrderType.LIMIT,
        status: OrderStatus.NEW,
      });
      const ledger = ledgerOf(...holdings, reserved);

      expect(
        decideOrder(ledger, intent(OrderSide.SELL, 4, '120')),
      ).toMatchObject({ rejectionReason: RejectionReason.INSUFFICIENT_SHARES });
      expect(
        decideOrder(ledger, intent(OrderSide.SELL, 3, '120')),
      ).toMatchObject({ status: OrderStatus.FILLED });
    });

    it('rejects a sell when a NEW SELL already reserves every share', () => {
      const reserved = order(OrderSide.SELL, 10, '150.00', {
        type: OrderType.LIMIT,
        status: OrderStatus.NEW,
      });

      expect(
        decideOrder(
          ledgerOf(...holdings, reserved),
          intent(OrderSide.SELL, 1, '120', OrderType.LIMIT),
        ),
      ).toMatchObject({ rejectionReason: RejectionReason.INSUFFICIENT_SHARES });
    });

    it('rejects any sell against an anomalous negative holding, never deepening it', () => {
      const oversold = ledgerOf(
        order(OrderSide.BUY, 20, '100.00'),
        order(OrderSide.SELL, 30, '100.00'),
      );
      expect(oversold.holdings.get(STOCK)?.quantity).toBe(-10);

      expect(
        decideOrder(oversold, intent(OrderSide.SELL, 1, '100')),
      ).toMatchObject({ rejectionReason: RejectionReason.INSUFFICIENT_SHARES });
    });

    it('is not blocked by cash: selling needs shares, not funds', () => {
      expect(
        decideOrder(
          ledgerOf(order(OrderSide.BUY, 5, '1.00', { size: 5 })),
          intent(OrderSide.SELL, 5, '1'),
        ),
      ).toMatchObject({ status: OrderStatus.FILLED });
    });
  });
});
