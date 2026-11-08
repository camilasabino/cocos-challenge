import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { InstrumentsRepository } from '../../instruments/instruments.repository';
import { MarketDataRepository } from '../../market-data/market-data.repository';
import {
  PortfolioReader,
  PortfolioSnapshot,
} from '../portfolio/portfolio.reader';
import { TradingRepository } from './trading.repository';

@Injectable()
export class TypeOrmPortfolioReader implements PortfolioReader {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trading: TradingRepository,
    private readonly instruments: InstrumentsRepository,
    private readonly marketData: MarketDataRepository,
  ) {}

  /** REPEATABLE READ + READ ONLY: one snapshot, no row locks, never blocks order placement. */
  async inSnapshot<T>(
    work: (snapshot: PortfolioSnapshot) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.startTransaction('REPEATABLE READ');
      // Must run before any query, i.e. before the snapshot is taken.
      await queryRunner.query('SET TRANSACTION READ ONLY');
      const result = await work(this.snapshotOver(queryRunner.manager));
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

  private snapshotOver(manager: EntityManager): PortfolioSnapshot {
    return {
      userExists: (userId) => this.trading.userExists(manager, userId),
      findLedgerOrders: (userId) =>
        this.trading.findLedgerOrders(manager, userId),
      findInstruments: (ids) => this.instruments.findByIds(manager, ids),
      findLatestPrices: (ids) =>
        this.marketData.findLatestByInstrumentIds(manager, ids),
    };
  }
}
