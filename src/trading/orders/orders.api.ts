import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiError,
  SERVICE_UNAVAILABLE_ERROR,
} from '../../common/error.response';
import { OrderResponse } from './order.response';
import { PlaceOrderDto } from './place-order.dto';

const order = (overrides: Partial<Record<string, unknown>>) => ({
  id: 15,
  userId: 1,
  instrumentId: 2,
  side: 'BUY',
  type: 'MARKET',
  status: 'FILLED',
  size: 10,
  price: '1050.00',
  datetime: '2026-11-08T15:04:05.123Z',
  rejectionReason: null,
  ...overrides,
});

export function ApiPlaceOrder(): MethodDecorator {
  return applyDecorators(
    ApiTags('Orders'),
    ApiExtraModels(OrderResponse),
    ApiOperation({
      summary: 'Place a BUY or SELL order',
      description: [
        'Persists the order in `orders` and returns it. **This modifies database state.**',
        '',
        '**Quantity.** Send exactly one of `size` (whole shares) or `amount` (ARS). With `amount` the quantity is `floor(amount / price)`: no fractional shares; if it is 0 the request fails with `ZERO_QUANTITY` and nothing is persisted.',
        '',
        '**Type.** `MARKET` must not carry a `price`; it executes at the latest market `close` and is `FILLED`. `LIMIT` requires `price` (the limit price, also used to size `amount`); it is stored as `NEW` and this system never fills it.',
        '',
        '**Validation.** BUY needs enough available cash (`cashBalance` minus cash reserved by open BUY orders). SELL needs enough shares (held minus shares reserved by open SELL orders). Otherwise the order is persisted as `REJECTED` and the response is **201** with `rejectionReason`; this is a business outcome, not an error.',
        '',
        '**Money** (`amount`, `price`) travels as decimal strings: greater than 0, at most 2 decimals, at most 99999999.99. They are rejected, never rounded.',
        '',
        '**Concurrency.** Orders of the same user are serialized. There are no idempotency keys: retrying after a `503` or a lost response can create a duplicate order, because the outcome of a commit interrupted by a connection failure is unknown.',
      ].join('\n'),
    }),
    ApiBody({
      type: PlaceOrderDto,
      examples: {
        marketBuyBySize: {
          summary: 'MARKET BUY, exact shares',
          value: {
            userId: 1,
            instrumentId: 2,
            side: 'BUY',
            type: 'MARKET',
            size: 10,
          },
        },
        marketSellBySize: {
          summary: 'MARKET SELL, exact shares',
          value: {
            userId: 1,
            instrumentId: 5,
            side: 'SELL',
            type: 'MARKET',
            size: 5,
          },
        },
        marketBuyByAmount: {
          summary: 'MARKET BUY, quantity derived from an ARS amount',
          value: {
            userId: 1,
            instrumentId: 4,
            side: 'BUY',
            type: 'MARKET',
            amount: '5000.00',
          },
        },
        limitBuy: {
          summary: 'LIMIT BUY (stored as NEW)',
          value: {
            userId: 1,
            instrumentId: 2,
            side: 'BUY',
            type: 'LIMIT',
            size: 10,
            price: '1000.00',
          },
        },
        limitSellByAmount: {
          summary: 'LIMIT SELL sized by amount at the limit price',
          value: {
            userId: 1,
            instrumentId: 5,
            side: 'SELL',
            type: 'LIMIT',
            amount: '19000.00',
            price: '1900.00',
          },
        },
      },
    }),
    ApiCreatedResponse({
      description:
        'The order was persisted: `FILLED`, `NEW` or `REJECTED` (see `status` and `rejectionReason`).',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/OrderResponse' },
          examples: {
            filled: {
              summary: 'MARKET order executed at the latest close',
              value: order({}),
            },
            new: {
              summary: 'LIMIT order accepted and left open',
              value: order({
                id: 16,
                type: 'LIMIT',
                status: 'NEW',
                price: '1000.00',
              }),
            },
            rejectedFunds: {
              summary: 'BUY larger than the available cash (persisted)',
              value: order({
                id: 17,
                size: 100000,
                status: 'REJECTED',
                rejectionReason: 'INSUFFICIENT_FUNDS',
              }),
            },
            rejectedShares: {
              summary: 'SELL larger than the available shares (persisted)',
              value: order({
                id: 18,
                side: 'SELL',
                size: 1000,
                status: 'REJECTED',
                rejectionReason: 'INSUFFICIENT_SHARES',
              }),
            },
          },
        },
      },
    }),
    ApiError(
      400,
      'Invalid body: missing/unknown fields, wrong types, both or neither of `size`/`amount`, `price` missing for LIMIT or present for MARKET, or an invalid amount/price.',
      [
        {
          summary: 'Cross-field rule violated',
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [
            {
              field: 'price',
              message: 'price is required for LIMIT orders',
            },
          ],
        },
      ],
    ),
    ApiError(
      404,
      'The user or the instrument does not exist. Nothing is persisted.',
      [
        {
          summary: 'Unknown user',
          code: 'USER_NOT_FOUND',
          message: 'User 9999 not found',
        },
        {
          summary: 'Unknown instrument',
          code: 'INSTRUMENT_NOT_FOUND',
          message: 'Instrument 9999 not found',
        },
      ],
    ),
    ApiError(422, 'The order cannot be built. Nothing is persisted.', [
      {
        summary: 'Cash (MONEDA) instruments cannot be traded',
        code: 'INSTRUMENT_NOT_TRADABLE',
        message: 'Instrument 1 cannot be traded',
      },
      {
        summary: 'MARKET order on an instrument without a usable price',
        code: 'PRICE_UNAVAILABLE',
        message: 'No market price is available for instrument 7',
      },
      {
        summary: 'The amount does not buy a single share',
        code: 'ZERO_QUANTITY',
        message:
          'The amount is too small to buy or sell a single share at this price',
      },
      {
        summary: 'The amount yields more shares than the schema can store',
        code: 'QUANTITY_OUT_OF_RANGE',
        message: 'The amount results in more than 2147483647 shares',
      },
    ]),
    ApiError(
      503,
      'PostgreSQL is temporarily unavailable (unreachable, connection lost, pool exhausted or per-user lock wait timed out). If it happened while committing, the order may or may not have been stored.',
      [SERVICE_UNAVAILABLE_ERROR],
    ),
  );
}
