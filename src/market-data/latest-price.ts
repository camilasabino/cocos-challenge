import Decimal from 'decimal.js';

export interface LatestPrice {
  close: Decimal;
  previousClose: Decimal | null;
}
