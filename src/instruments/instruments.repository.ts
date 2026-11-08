import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Instrument } from './instrument.entity';
import { escapeLikePattern } from './like-pattern';

export interface InstrumentRecord {
  id: number;
  ticker: string | null;
  name: string | null;
  type: string | null;
}

export interface InstrumentSearch {
  text: string;
  excludedType: string;
  limit: number;
}

@Injectable()
export class InstrumentsRepository {
  constructor(
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
  ) {}

  /** Ranking: exact ticker, ticker prefix, other matches; ties by ticker, then id. */
  async search({
    text,
    excludedType,
    limit,
  }: InstrumentSearch): Promise<InstrumentRecord[]> {
    const escaped = escapeLikePattern(text);

    const found = await this.instruments
      .createQueryBuilder('instrument')
      .where('instrument.type <> :excludedType', { excludedType })
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
    return found.map(toRecord);
  }

  async findById(id: number): Promise<InstrumentRecord | null> {
    const found = await this.instruments.findOneBy({ id });
    return found && toRecord(found);
  }

  async findByIds(
    manager: EntityManager,
    ids: readonly number[],
  ): Promise<Map<number, InstrumentRecord>> {
    if (ids.length === 0) return new Map();
    const found = await manager
      .createQueryBuilder(Instrument, 'instrument')
      .where('instrument.id = ANY(:ids)', { ids: [...ids] })
      .getMany();
    return new Map(
      found.map((instrument) => [instrument.id, toRecord(instrument)]),
    );
  }
}

function toRecord({ id, ticker, name, type }: Instrument): InstrumentRecord {
  return { id, ticker, name, type };
}
