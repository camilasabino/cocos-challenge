import Decimal from 'decimal.js';
import { LatestPrice } from '../../market-data/latest-price';
import { LedgerOrder } from '../domain/account-ledger';
import { OrderSide, OrderStatus, OrderType } from '../domain/order.types';

export interface OrderInstrument {
  id: number;
  type: string | null;
}

export interface NewOrder {
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  size: number;
  price: Decimal;
}

export interface InsertedOrder {
  id: number;
  datetime: Date;
}

export interface OrderPlacementTx {
  /** Must run before any balance-dependent read. Returns false if the user does not exist. */
  lockUser(userId: number): Promise<boolean>;
  findLatestPrice(instrumentId: number): Promise<LatestPrice | undefined>;
  findLedgerOrders(userId: number): Promise<LedgerOrder[]>;
  insertOrder(order: NewOrder): Promise<InsertedOrder>;
}

export abstract class OrderPlacementStore {
  abstract findInstrument(id: number): Promise<OrderInstrument | null>;

  /**
   * Commits when `work` resolves, rolls back when it throws. Placements for
   * the same user are serialized. Lock timeouts and lost connections surface
   * as driver errors; the HTTP exception filter turns them into 503.
   */
  abstract inTransaction<T>(
    work: (tx: OrderPlacementTx) => Promise<T>,
  ): Promise<T>;
}
