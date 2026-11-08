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
import { OrderPlacementStore, OrderPlacementTx } from './order-placement.store';

export interface PlaceOrderCommand {
  userId: number;
  instrumentId: number;
  side: OrderSide.BUY | OrderSide.SELL;
  type: OrderType;
  quantity: QuantityRequest;
  limitPrice: Decimal | null;
}

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

  /** A REJECTED order is a successful outcome and is committed; any error rolls back. */
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

    const placed = await this.store.inTransaction((tx) =>
      this.placeInTransaction(tx, command),
    );

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
    // A non-positive close counts as no usable price; data is not corrected.
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
