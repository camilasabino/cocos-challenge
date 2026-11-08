import Decimal from 'decimal.js';

// Isolated constructor: configuring the global Decimal would affect other
// consumers. 40 digits keep divisions exact in practice; rounding happens only
// when formatting.
const Dec = Decimal.clone({ precision: 40 });

export const ZERO: Decimal = new Dec(0);

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

export function isDecimalString(value: string, maxDecimals?: number): boolean {
  if (!NUMERIC_PATTERN.test(value)) return false;
  if (maxDecimals === undefined) return true;
  const decimals = value.split('.')[1]?.length ?? 0;
  return decimals <= maxDecimals;
}

export function parseDecimal(value: string): Decimal {
  if (!isDecimalString(value)) {
    throw new Error(`Invalid decimal string: "${value}"`);
  }
  return new Dec(value);
}

/** HALF_UP (ties away from zero); never renders `-0.00`. */
function formatTwoDecimals(value: Decimal): string {
  const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0.00' : rounded.toFixed(2);
}

export function formatMoney(value: Decimal): string {
  return formatTwoDecimals(value);
}

export function formatPercent(value: Decimal): string {
  return formatTwoDecimals(value);
}
