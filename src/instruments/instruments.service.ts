import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CASH_INSTRUMENT_TYPE, Instrument } from './instrument.entity';
import { escapeLikePattern } from './like-pattern';

@Injectable()
export class InstrumentsService {
  constructor(
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
  ) {}

  /**
   * Case-insensitive substring search on ticker or name, excluding cash.
   * Ranking: exact ticker, then ticker prefix, then any other match; ties are
   * broken by ticker and finally id, so the order is fully deterministic.
   * All user input travels as bound parameters, with LIKE wildcards escaped.
   */
  search(query: string, limit: number): Promise<Instrument[]> {
    const escaped = escapeLikePattern(query);

    return this.instruments
      .createQueryBuilder('instrument')
      .where('instrument.type <> :cashType', {
        cashType: CASH_INSTRUMENT_TYPE,
      })
      .andWhere(
        `(instrument.ticker ILIKE :contains ESCAPE '\\' OR instrument.name ILIKE :contains ESCAPE '\\')`,
        { contains: `%${escaped}%` },
      )
      .addSelect(
        `CASE
           WHEN instrument.ticker ILIKE :exact ESCAPE '\\' THEN 0
           WHEN instrument.ticker ILIKE :prefix ESCAPE '\\' THEN 1
           ELSE 2
         END`,
        'match_rank',
      )
      .setParameters({ exact: escaped, prefix: `${escaped}%` })
      .orderBy('match_rank', 'ASC')
      .addOrderBy('instrument.ticker', 'ASC')
      .addOrderBy('instrument.id', 'ASC')
      .limit(limit)
      .getMany();
  }

  findById(id: number): Promise<Instrument | null> {
    return this.instruments.findOneBy({ id });
  }

  /**
   * Batch lookup (one statement) keyed by id. Runs on the caller's manager so
   * it can share a transaction snapshot. Unknown ids are simply absent.
   */
  async findByIds(
    manager: EntityManager,
    ids: readonly number[],
  ): Promise<Map<number, Instrument>> {
    if (ids.length === 0) return new Map();
    const found = await manager
      .createQueryBuilder(Instrument, 'instrument')
      .where('instrument.id = ANY(:ids)', { ids: [...ids] })
      .getMany();
    return new Map(found.map((instrument) => [instrument.id, instrument]));
  }
}
