import { LatestPrice } from '../../market-data/latest-price';
import { LedgerOrder } from '../domain/account-ledger';
import { InstrumentInfo } from '../domain/portfolio-valuation';

/** Reads available inside one consistent snapshot. */
export interface PortfolioSnapshot {
  userExists(userId: number): Promise<boolean>;
  /** Balance-affecting orders of the user (FILLED and NEW). */
  findLedgerOrders(userId: number): Promise<LedgerOrder[]>;
  /** Unknown ids are absent from the result. */
  findInstruments(ids: readonly number[]): Promise<Map<number, InstrumentInfo>>;
  /** Instruments without a usable latest price are absent from the result. */
  findLatestPrices(ids: readonly number[]): Promise<Map<number, LatestPrice>>;
}

/**
 * Read-side port of the portfolio use case. The callback shape keeps the
 * workflow in the service: which instruments to read depends on the ledger,
 * which is domain logic.
 */
export abstract class PortfolioReader {
  /**
   * Runs `work` against a single read-only snapshot: every read sees the same
   * committed state, takes no row locks and never blocks order placement.
   */
  abstract inSnapshot<T>(
    work: (snapshot: PortfolioSnapshot) => Promise<T>,
  ): Promise<T>;
}
