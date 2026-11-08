import Decimal from 'decimal.js';

// Isolated constructor: configuring the global Decimal would affect any other
// consumer of the library. 40 significant digits leave ample headroom over
// NUMERIC(10,2) inputs, so divisions (e.g. cost basis / quantity) stay exact
// for every practical purpose; rounding happens only when formatting.
const Dec = Decimal.clone({ precision: 40 });

export const ZERO: Decimal = new Dec(0);

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

/** True for plain decimal notation (`"12"`, `"-0.5"`, `"925.85"`); no exponent, sign prefix `+` or `NaN`. */
export function isDecimalString(value: string, maxDecimals?: number): boolean {
  if (!NUMERIC_PATTERN.test(value)) return false;
  if (maxDecimals === undefined) return true;
  const decimals = value.split('.')[1]?.length ?? 0;
  return decimals <= maxDecimals;
}

/** Parses a Postgres NUMERIC / request decimal string. Throws on anything that is not plain decimal notation. */
export function parseDecimal(value: string): Decimal {
  if (!isDecimalString(value)) {
    throw new Error(`Invalid decimal string: "${value}"`);
  }
  return new Dec(value);
}

/** Rounds HALF_UP (ties away from zero) to 2 decimals; never renders `-0.00`. */
function formatTwoDecimals(value: Decimal): string {
  const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0.00' : rounded.toFixed(2);
}

export function formatMoney(value: Decimal): string {
  return formatTwoDecimals(value);
}

/** Formats a percentage value already expressed in percent (e.g. `-0.4486` -> `"-0.45"`); no `%` suffix. */
export function formatPercent(value: Decimal): string {
  return formatTwoDecimals(value);
}
