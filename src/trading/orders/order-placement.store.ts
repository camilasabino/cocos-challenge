import Decimal from 'decimal.js';
import { LatestPrice } from '../../market-data/latest-price';
import { LedgerOrder } from '../domain/account-ledger';
import { OrderSide, OrderStatus, OrderType } from '../domain/order.types';

/** The instrument attributes order placement needs. */
export interface OrderInstrument {
  id: number;
  type: string | null;
}

/** A decided order ready to be stored. `datetime` is assigned by the store. */
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
  /** UTC instant assigned when the order was stored, after the user lock was granted. */
  datetime: Date;
}

/** Operations available inside one order-placement transaction. */
export interface OrderPlacementTx {
  /**
   * Locks the user until the transaction ends, serializing every placement for
   * that user; returns false when the user does not exist. Must run before any
   * balance-dependent read so those reads see earlier placements.
   */
  lockUser(userId: number): Promise<boolean>;
  /** Latest quote; undefined when there is none or its close is missing. */
  findLatestPrice(instrumentId: number): Promise<LatestPrice | undefined>;
  /** Balance-affecting orders of the user (FILLED and NEW). */
  findLedgerOrders(userId: number): Promise<LedgerOrder[]>;
  insertOrder(order: NewOrder): Promise<InsertedOrder>;
}

/**
 * The store cannot serve the request right now (lock wait timed out, database
 * unreachable). Nothing was committed, so the client may retry.
 */
export class StorageUnavailableError extends Error {
  constructor(
    /** Short, value-free diagnostic code, safe to log. */
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Storage unavailable (${reason})`, options);
    this.name = 'StorageUnavailableError';
  }
}

/** Persistence port of the order-placement use case. */
export abstract class OrderPlacementStore {
  /** Reference-data lookup, outside any placement transaction. */
  abstract findInstrument(id: number): Promise<OrderInstrument | null>;

  /**
   * Runs `work` in one transaction in which concurrent placements for the same
   * user are serialized and each read sees the latest committed state.
   * Lock waits are bounded by the configured timeout. The transaction commits
   * when `work` resolves and rolls back when it throws.
   *
   * @throws StorageUnavailableError on a lock timeout or lost database.
   */
  abstract inTransaction<T>(
    work: (tx: OrderPlacementTx) => Promise<T>,
  ): Promise<T>;
}
