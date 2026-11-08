import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { parseDecimal } from '../common/decimal';
import { LatestPrice } from './latest-price';
import { MarketData } from './market-data.entity';

interface LatestPriceRow {
  instrumentId: number;
  close: string | null;
  previousClose: string | null;
}

@Injectable()
export class MarketDataRepository {
  /**
   * Latest row by `date`, ties broken by highest `id` (the schema does not
   * guarantee one row per instrument and day). A latest row without `close` is
   * omitted: falling back to an older close would be a silently stale price.
   */
  async findLatestByInstrumentIds(
    manager: EntityManager,
    instrumentIds: readonly number[],
  ): Promise<Map<number, LatestPrice>> {
    const prices = new Map<number, LatestPrice>();
    if (instrumentIds.length === 0) return prices;

    const rows = await manager
      .createQueryBuilder(MarketData, 'md')
      .distinctOn(['md.instrumentId'])
      .select('md.instrumentId', 'instrumentId')
      .addSelect('md.close', 'close')
      .addSelect('md.previousClose', 'previousClose')
      .where('md.instrumentId = ANY(:instrumentIds)', {
        instrumentIds: [...instrumentIds],
      })
      .orderBy('md.instrumentId', 'ASC')
      .addOrderBy('md.date', 'DESC')
      .addOrderBy('md.id', 'DESC')
      .getRawMany<LatestPriceRow>();

    for (const row of rows) {
      if (row.close === null) continue;
      prices.set(row.instrumentId, {
        close: parseDecimal(row.close),
        previousClose:
          row.previousClose === null ? null : parseDecimal(row.previousClose),
      });
    }
    return prices;
  }
}
