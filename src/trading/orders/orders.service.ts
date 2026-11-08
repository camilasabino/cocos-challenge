import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AppError } from '../../common/app-error';
import { CASH_INSTRUMENT_TYPE } from '../../instruments/instrument-type';
import { buildAccountLedger } from '../domain/account-ledger';
import { decideOrder } from '../domain/order-decision';
import {
  MAX_ORDER_SIZE,
  QuantityRequest,
  resolveQuantity,
} from '../domain/order-sizing';
import {
  OrderSide,
  OrderStatus,
  OrderType,
  RejectionReason,
} from '../domain/order.types';
import {
  OrderPlacementStore,
  OrderPlacementTx,
  StorageUnavailableError,
} from './order-placement.store';

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

  constructor(private readonly store: OrderPlacementStore) {}

  /**
   * Places one order in a single transaction. The user lock is taken first, so
   * balances are read only after earlier placements for that user committed.
   * Every read and the insert run in the same transaction. Any error rolls it
   * back; a REJECTED order is a successful outcome and is committed.
   */
  async placeOrder(command: PlaceOrderCommand): Promise<PlacedOrder> {
    const instrument = await this.store.findInstrument(command.instrumentId);
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
      placed = await this.store.inTransaction((tx) =>
        this.placeInTransaction(tx, command),
      );
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        // Lock timeout or unreachable database: nothing was committed.
        this.logger.warn(
          `Order placement unavailable (database error ${error.reason}) for user ${command.userId}`,
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
    tx: OrderPlacementTx,
    command: PlaceOrderCommand,
  ): Promise<PlacedOrder> {
    const { userId, instrumentId, side, type } = command;

    if (!(await tx.lockUser(userId))) {
      throw new AppError(404, 'USER_NOT_FOUND', `User ${userId} not found`);
    }

    const price = await this.resolvePrice(tx, command);
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

    const ledger = buildAccountLedger(await tx.findLedgerOrders(userId));
    const decision = decideOrder(ledger, {
      side,
      type,
      instrumentId,
      quantity,
      price,
    });

    const inserted = await tx.insertOrder({
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
    tx: OrderPlacementTx,
    command: PlaceOrderCommand,
  ): Promise<Decimal> {
    if (command.type === OrderType.LIMIT) {
      if (command.limitPrice === null) {
        throw new Error('A LIMIT order reached the service without a price');
      }
      return command.limitPrice;
    }

    const close = (await tx.findLatestPrice(command.instrumentId))?.close;
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
