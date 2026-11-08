import { ApiProperty } from '@nestjs/swagger';
import { formatMoney } from '../../common/decimal';
import { PlacedOrder } from './orders.service';

export class OrderResponse {
  @ApiProperty({ example: 15 })
  id!: number;

  @ApiProperty({ example: 1 })
  userId!: number;

  @ApiProperty({ example: 2 })
  instrumentId!: number;

  @ApiProperty({ enum: ['BUY', 'SELL'] })
  side!: string;

  @ApiProperty({ enum: ['MARKET', 'LIMIT'] })
  type!: string;

  @ApiProperty({
    enum: ['FILLED', 'NEW', 'REJECTED'],
    description:
      '`FILLED`: executed (every accepted MARKET order). `NEW`: accepted LIMIT order, open and never executed by this system. `REJECTED`: not enough cash or shares; the order is still persisted.',
  })
  status!: string;

  @ApiProperty({
    description:
      'Whole shares: the requested `size`, or derived from `amount`.',
    example: 10,
  })
  size!: number;

  @ApiProperty({
    pattern: '^\\d+\\.\\d{2}$',
    description:
      'Execution price in ARS: the latest `close` for MARKET orders, the requested `price` for LIMIT orders. Decimal string.',
    example: '1050.00',
  })
  price!: string;

  @ApiProperty({
    description: 'Placement time in UTC (ISO 8601).',
    example: '2026-11-08T15:04:05.123Z',
  })
  datetime!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['INSUFFICIENT_FUNDS', 'INSUFFICIENT_SHARES'],
    description:
      'Why the order was rejected; `null` unless `status` is `REJECTED`.',
    example: null,
  })
  rejectionReason!: string | null;
}

export function toOrderResponse(order: PlacedOrder): OrderResponse {
  return {
    id: order.id,
    userId: order.userId,
    instrumentId: order.instrumentId,
    side: order.side,
    type: order.type,
    status: order.status,
    size: order.size,
    price: formatMoney(order.price),
    datetime: order.datetime.toISOString(),
    rejectionReason: order.rejectionReason,
  };
}
