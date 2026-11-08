import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../common/app-error';
import { InstrumentsService } from '../instruments/instruments.service';
import { MarketDataRepository } from '../market-data/market-data.repository';
import { buildAccountLedger } from './account-ledger';
import {
  Portfolio,
  openPositionInstrumentIds,
  valuePortfolio,
} from './portfolio-valuation';
import { TradingRepository } from './trading.repository';

@Injectable()
export class PortfolioService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trading: TradingRepository,
    private readonly instruments: InstrumentsService,
    private readonly marketData: MarketDataRepository,
  ) {}

  /**
   * Reads everything from one snapshot and values it with the pure domain
   * functions. Query budget is constant: user, ledger orders and, when the
   * account holds anything, one batched price query and one batched
   * instrument query — regardless of the number of positions.
   */
  getPortfolio(userId: number): Promise<Portfolio> {
    return this.inReadOnlySnapshot(async (manager) => {
      if (!(await this.trading.userExists(manager, userId))) {
        throw new AppError(404, 'USER_NOT_FOUND', `User ${userId} not found`);
      }

      const ledger = buildAccountLedger(
        await this.trading.findLedgerOrders(manager, userId),
      );
      const instrumentIds = openPositionInstrumentIds(ledger);
      const instruments = await this.instruments.findByIds(
        manager,
        instrumentIds,
      );
      const prices = await this.marketData.findLatestByInstrumentIds(
        manager,
        instrumentIds,
      );

      return valuePortfolio({ userId, ledger, instruments, prices });
    });
  }

  /**
   * REPEATABLE READ + READ ONLY: every query sees the same committed state, so
   * orders, prices and instruments cannot disagree because of a concurrent
   * write. In PostgreSQL this takes no row locks and never blocks (or is
   * blocked by) order placement.
   */
  private async inReadOnlySnapshot<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.startTransaction('REPEATABLE READ');
      // Must be the first statement of the transaction, before the snapshot is taken.
      await queryRunner.query('SET TRANSACTION READ ONLY');
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
