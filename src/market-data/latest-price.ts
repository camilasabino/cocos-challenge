import Decimal from 'decimal.js';

/** Latest known quote of an instrument. Plain type so pure modules can use it. */
export interface LatestPrice {
  close: Decimal;
  /** Null when the source row has no previous close. */
  previousClose: Decimal | null;
}
