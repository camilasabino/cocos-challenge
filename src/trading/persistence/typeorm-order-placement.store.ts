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
   * READ COMMITTED is required: after waiting on the user's row lock, each
   * statement must see what the previous holder committed. A REPEATABLE READ
   * snapshot would predate the wait and miss it.
   */
  async inTransaction<T>(
    work: (tx: OrderPlacementTx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(
        'READ COMMITTED',
        async (manager) => {
          // SET LOCAL cannot take a bound value; set_config(…, true) is equivalent.
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
