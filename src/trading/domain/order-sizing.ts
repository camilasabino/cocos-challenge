import Decimal from 'decimal.js';

export const MAX_ORDER_SIZE = 2147483647;

export type QuantityRequest = { size: number } | { amount: Decimal };

/**
 * `{ amount }` resolves to an exact `floor(amount / price)`, which may be 0.
 * The result is not bounded to the `orders.size` INT column; the caller must.
 */
export function resolveQuantity(
  request: QuantityRequest,
  price: Decimal,
): number {
  if ('size' in request) {
    if (!Number.isSafeInteger(request.size) || request.size <= 0) {
      throw new RangeError(
        `size must be a positive integer, got ${request.size}`,
      );
    }
    return request.size;
  }

  if (price.lessThanOrEqualTo(0)) {
    throw new RangeError(
      `price must be greater than zero, got ${price.toString()}`,
    );
  }
  if (request.amount.isNegative()) {
    throw new RangeError(
      `amount must not be negative, got ${request.amount.toString()}`,
    );
  }

  // divToInt truncates the exact quotient, independent of the working precision.
  const shares = request.amount.divToInt(price);
  if (shares.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Resulting quantity is not a safe integer');
  }
  return shares.toNumber();
}
