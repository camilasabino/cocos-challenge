import { LatestPrice } from '../../market-data/latest-price';
import { LedgerOrder } from '../domain/account-ledger';
import { InstrumentInfo } from '../domain/portfolio-valuation';

export interface PortfolioSnapshot {
  userExists(userId: number): Promise<boolean>;
  findLedgerOrders(userId: number): Promise<LedgerOrder[]>;
  findInstruments(ids: readonly number[]): Promise<Map<number, InstrumentInfo>>;
  findLatestPrices(ids: readonly number[]): Promise<Map<number, LatestPrice>>;
}

export abstract class PortfolioReader {
  /** Every read inside `work` sees the same committed state; no row locks. */
  abstract inSnapshot<T>(
    work: (snapshot: PortfolioSnapshot) => Promise<T>,
  ): Promise<T>;
}
