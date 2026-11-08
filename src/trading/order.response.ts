import { formatMoney } from '../common/decimal';
import { PlacedOrder } from './orders.service';

/** Wire format of an order (§4.3). Money is a 2-decimal string; `datetime` is ISO-8601 UTC. */
export interface OrderResponse {
  id: number;
  userId: number;
  instrumentId: number;
  side: string;
  type: string;
  status: string;
  size: number;
  price: string;
  datetime: string;
  rejectionReason: string | null;
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
