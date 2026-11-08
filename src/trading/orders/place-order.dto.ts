import {
  IsEnum,
  IsIn,
  IsInt,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isDecimalString, parseDecimal } from '../../common/decimal';
import { OrderSide, OrderType } from '../domain/order.types';
import { MAX_ORDER_SIZE } from '../domain/order-sizing';

const MAX_ID = 2147483647;
/** NUMERIC(10,2) maximum. */
export const MAX_MONEY = '99999999.99';
const MONEY_DECIMALS = 2;

/** Invalid values are rejected, never rounded. */
function isValidMoney(value: unknown): value is string {
  if (typeof value !== 'string' || !isDecimalString(value, MONEY_DECIMALS)) {
    return false;
  }
  const money = parseDecimal(value);
  return money.greaterThan(0) && money.lessThanOrEqualTo(MAX_MONEY);
}

const MONEY_RULE = `a decimal string greater than 0, up to ${MAX_MONEY}, with at most ${MONEY_DECIMALS} decimals`;

@ValidatorConstraint({ name: 'orderSize', async: false })
class OrderSizeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= MAX_ORDER_SIZE
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return args.value === undefined
      ? 'exactly one of size or amount is required'
      : `size must be an integer between 1 and ${MAX_ORDER_SIZE}`;
  }
}

@ValidatorConstraint({ name: 'orderAmount', async: false })
class OrderAmountConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const { size } = args.object as PlaceOrderDto;
    return size === undefined && isValidMoney(value);
  }

  defaultMessage(args: ValidationArguments): string {
    const { size } = args.object as PlaceOrderDto;
    return size !== undefined
      ? 'size and amount are mutually exclusive; provide exactly one'
      : `amount must be ${MONEY_RULE}`;
  }
}

@ValidatorConstraint({ name: 'orderPrice', async: false })
class OrderPriceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const { type } = args.object as PlaceOrderDto;
    if (type === OrderType.MARKET) return false;
    return isValidMoney(value);
  }

  defaultMessage(args: ValidationArguments): string {
    const { type } = args.object as PlaceOrderDto;
    if (type === OrderType.MARKET) {
      return 'price must not be provided for MARKET orders';
    }
    return args.value === undefined
      ? 'price is required for LIMIT orders'
      : `price must be ${MONEY_RULE}`;
  }
}

/**
 * Money travels as decimal strings, so no float ever touches a price.
 * Cross-field rules live in the constraints because class-validator
 * evaluates them per property.
 */
export class PlaceOrderDto {
  @IsInt()
  @Min(1)
  @Max(MAX_ID)
  userId!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_ID)
  instrumentId!: number;

  // CASH_IN / CASH_OUT are valid order sides in the data but not through this endpoint.
  @IsIn([OrderSide.BUY, OrderSide.SELL])
  side!: OrderSide.BUY | OrderSide.SELL;

  @IsEnum(OrderType)
  type!: OrderType;

  @ValidateIf(
    (dto: PlaceOrderDto) => dto.size !== undefined || dto.amount === undefined,
  )
  @Validate(OrderSizeConstraint)
  size?: number;

  @ValidateIf((dto: PlaceOrderDto) => dto.amount !== undefined)
  @Validate(OrderAmountConstraint)
  amount?: string;

  @ValidateIf(
    (dto: PlaceOrderDto) =>
      dto.price !== undefined || dto.type === OrderType.LIMIT,
  )
  @Validate(OrderPriceConstraint)
  price?: string;
}
