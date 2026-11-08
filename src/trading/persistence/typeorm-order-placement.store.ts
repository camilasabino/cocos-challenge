import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  describeDatabaseError,
  isTemporarilyUnavailable,
} from '../../common/database-errors';
import { Env } from '../../config/env';
import { InstrumentsRepository } from '../../instruments/instruments.repository';
import { MarketDataRepository } from '../../market-data/market-data.repository';
import {
  OrderInstrument,
  OrderPlacementStore,
  OrderPlacementTx,
  StorageUnavailableError,
} from '../orders/order-placement.store';
import { TradingRepository } from './trading.repository';

@Injectable()
export class TypeOrmOrderPlacementStore implements OrderPlacementStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
    private readonly trading: TradingRepository,
    private readonly instruments: InstrumentsRepository,
    private readonly marketData: MarketDataRepository,
  ) {}

  async findInstrument(id: number): Promise<OrderInstrument | null> {
    const instrument = await this.instruments.findById(id);
    return instrument && { id: instrument.id, type: instrument.type };
  }

  /**
   * Concurrency: the caller locks the user's row first (`SELECT … FOR UPDATE`),
   * so every placement for that user is serialized by PostgreSQL itself —
   * across processes and instances. READ COMMITTED is required: each statement
   * sees the latest committed state, including what the previous lock holder
   * just wrote; a REPEATABLE READ snapshot would predate the lock wait and
   * miss it. Only the user's row is locked, so placements cannot deadlock with
   * each other.
   */
  async inTransaction<T>(
    work: (tx: OrderPlacementTx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(
        'READ COMMITTED',
        async (manager) => {
          // `lock_timeout` cannot be parameterized in SET; set_config(…, true) is
          // the transaction-local equivalent of SET LOCAL and takes a bound value.
          await manager.query(`SELECT set_config('lock_timeout', $1, true)`, [
            `${this.config.get('DB_LOCK_TIMEOUT_MS', { infer: true })}ms`,
          ]);
          return work(this.txOver(manager));
        },
      );
    } catch (error) {
      if (isTemporarilyUnavailable(error)) {
        throw new StorageUnavailableError(describeDatabaseError(error), {
          cause: error,
        });
      }
      throw error;
    }
  }

  private txOver(manager: EntityManager): OrderPlacementTx {
    return {
      lockUser: (userId) => this.trading.lockUser(manager, userId),
      findLatestPrice: async (instrumentId) =>
        (
          await this.marketData.findLatestByInstrumentIds(manager, [
            instrumentId,
          ])
        ).get(instrumentId),
      findLedgerOrders: (userId) =>
        this.trading.findLedgerOrders(manager, userId),
      insertOrder: (order) => this.trading.insertOrder(manager, order),
    };
  }
}
