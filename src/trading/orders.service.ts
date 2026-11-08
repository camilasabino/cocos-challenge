import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../common/app-error';
import {
  describeDatabaseError,
  isTemporarilyUnavailable,
} from '../common/database-errors';
import { Env } from '../config/env';
import { CASH_INSTRUMENT_TYPE } from '../instruments/instrument.entity';
import { InstrumentsService } from '../instruments/instruments.service';
import { MarketDataRepository } from '../market-data/market-data.repository';
import { buildAccountLedger } from './account-ledger';
import { decideOrder } from './order-evaluation';
import {
  MAX_ORDER_SIZE,
  QuantityRequest,
  resolveQuantity,
} from './order-sizing';
import {
  OrderSide,
  OrderStatus,
  OrderType,
  RejectionReason,
} from './order.types';
import { TradingRepository } from './trading.repository';

/** What the caller asks for; everything else is resolved while placing. */
export interface PlaceOrderCommand {
  userId: number;
  instrumentId: number;
  side: OrderSide.BUY | OrderSide.SELL;
  type: OrderType;
  quantity: QuantityRequest;
  /** Required for LIMIT, null for MARKET (the DTO enforces it). */
  limitPrice: Decimal | null;
}

/** An order as persisted, plus the response-only rejection reason. */
export interface PlacedOrder {
  id: number;
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  size: number;
  price: Decimal;
  datetime: Date;
  rejectionReason: RejectionReason | null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
    private readonly trading: TradingRepository,
    private readonly instruments: InstrumentsService,
    private readonly marketData: MarketDataRepository,
  ) {}

  /**
   * Places one order in a single transaction (§2.5).
   *
   * Concurrency: the first thing the transaction does is lock the user's row
   * (`SELECT … FOR UPDATE`), so every placement for that user is serialized by
   * PostgreSQL itself — across processes and instances — and balances are
   * read only after earlier placements committed. READ COMMITTED is required:
   * each statement sees the latest committed state, including what the
   * previous lock holder just wrote; a REPEATABLE READ snapshot would predate
   * the lock wait and miss it. Only the user's row is locked and always first,
   * so placements cannot deadlock with each other.
   *
   * Everything that reads balances or writes the order uses the transaction's
   * EntityManager. Any error rolls the transaction back; a REJECTED order is
   * a successful outcome and is committed.
   */
  async placeOrder(command: PlaceOrderCommand): Promise<PlacedOrder> {
    const instrument = await this.instruments.findById(command.instrumentId);
    if (!instrument) {
      throw new AppError(
        404,
        'INSTRUMENT_NOT_FOUND',
        `Instrument ${command.instrumentId} not found`,
      );
    }
    if (instrument.type === CASH_INSTRUMENT_TYPE) {
      throw new AppError(
        422,
        'INSTRUMENT_NOT_TRADABLE',
        `Instrument ${command.instrumentId} cannot be traded`,
      );
    }

    let placed: PlacedOrder;
    try {
      placed = await this.dataSource.transaction('READ COMMITTED', (manager) =>
        this.placeInTransaction(manager, command),
      );
    } catch (error) {
      if (isTemporarilyUnavailable(error)) {
        // Lock timeout or unreachable database: nothing was committed.
        this.logger.warn(
          `Order placement unavailable (database error ${describeDatabaseError(error)}) for user ${command.userId}`,
        );
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'The service is temporarily unavailable, please retry',
        );
      }
      throw error;
    }

    this.logger.log(
      JSON.stringify({
        event: 'order_placed',
        orderId: placed.id,
        userId: placed.userId,
        status: placed.status,
        rejectionReason: placed.rejectionReason,
      }),
    );
    return placed;
  }

  private async placeInTransaction(
    manager: EntityManager,
    command: PlaceOrderCommand,
  ): Promise<PlacedOrder> {
    const { userId, instrumentId, side, type } = command;

    // `lock_timeout` cannot be parameterized in SET; set_config(…, true) is the
    // transaction-local equivalent of SET LOCAL and takes a bound value.
    await manager.query(`SELECT set_config('lock_timeout', $1, true)`, [
      `${this.config.get('DB_LOCK_TIMEOUT_MS', { infer: true })}ms`,
    ]);

    if (!(await this.trading.lockUser(manager, userId))) {
      throw new AppError(404, 'USER_NOT_FOUND', `User ${userId} not found`);
    }

    const price = await this.resolvePrice(manager, command);
    const quantity = resolveQuantity(command.quantity, price);
    if (quantity === 0) {
      throw new AppError(
        422,
        'ZERO_QUANTITY',
        'The amount is too small to buy or sell a single share at this price',
      );
    }
    if (quantity > MAX_ORDER_SIZE) {
      throw new AppError(
        422,
        'QUANTITY_OUT_OF_RANGE',
        `The amount results in more than ${MAX_ORDER_SIZE} shares`,
      );
    }

    const ledger = buildAccountLedger(
      await this.trading.findLedgerOrders(manager, userId),
    );
    const decision = decideOrder(ledger, {
      side,
      type,
      instrumentId,
      quantity,
      price,
    });

    const inserted = await this.trading.insertOrder(manager, {
      userId,
      instrumentId,
      side,
      type,
      status: decision.status,
      size: quantity,
      price,
    });

    return {
      id: inserted.id,
      userId,
      instrumentId,
      side,
      type,
      status: decision.status,
      size: quantity,
      price,
      datetime: inserted.datetime,
      rejectionReason: decision.rejectionReason,
    };
  }

  /** MARKET executes at the latest close; LIMIT at the requested price. */
  private async resolvePrice(
    manager: EntityManager,
    command: PlaceOrderCommand,
  ): Promise<Decimal> {
    if (command.type === OrderType.LIMIT) {
      if (command.limitPrice === null) {
        throw new Error('A LIMIT order reached the service without a price');
      }
      return command.limitPrice;
    }

    const latest = await this.marketData.findLatestByInstrumentIds(manager, [
      command.instrumentId,
    ]);
    const close = latest.get(command.instrumentId)?.close;
    // A non-positive close cannot execute an order (it would be free or
    // meaningless), so it counts as no usable price. Data is not corrected.
    if (!close || close.lessThanOrEqualTo(0)) {
      throw new AppError(
        422,
        'PRICE_UNAVAILABLE',
        `No market price is available for instrument ${command.instrumentId}`,
      );
    }
    return close;
  }
}
