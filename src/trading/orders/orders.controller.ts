import { Body, Controller, Post } from '@nestjs/common';
import { parseDecimal } from '../../common/decimal';
import { OrderType } from '../domain/order.types';
import { OrderResponse, toOrderResponse } from './order.response';
import { PlaceOrderDto } from './place-order.dto';
import { OrdersService, PlaceOrderCommand } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** 201 for every persisted order, including REJECTED ones (insufficient cash or shares). */
  @Post()
  async place(@Body() dto: PlaceOrderDto): Promise<OrderResponse> {
    return toOrderResponse(await this.orders.placeOrder(toCommand(dto)));
  }
}

/** DTO validation guarantees exactly one of size/amount and price iff LIMIT. */
function toCommand(dto: PlaceOrderDto): PlaceOrderCommand {
  return {
    userId: dto.userId,
    instrumentId: dto.instrumentId,
    side: dto.side,
    type: dto.type,
    quantity:
      dto.size !== undefined
        ? { size: dto.size }
        : { amount: parseDecimal(dto.amount as string) },
    limitPrice:
      dto.type === OrderType.LIMIT ? parseDecimal(dto.price as string) : null,
  };
}
