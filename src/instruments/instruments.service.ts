import { Injectable } from '@nestjs/common';
import { CASH_INSTRUMENT_TYPE } from './instrument-type';
import {
  InstrumentRecord,
  InstrumentsRepository,
} from './instruments.repository';

@Injectable()
export class InstrumentsService {
  constructor(private readonly instruments: InstrumentsRepository) {}

  /** Cash is not tradable, so search never offers it. */
  search(query: string, limit: number): Promise<InstrumentRecord[]> {
    return this.instruments.search({
      text: query,
      excludedType: CASH_INSTRUMENT_TYPE,
      limit,
    });
  }
}
