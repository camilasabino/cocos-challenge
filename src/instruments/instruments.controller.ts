import { Controller, Get, Query } from '@nestjs/common';
import { InstrumentsService } from './instruments.service';
import { SearchInstrumentsDto } from './search-instruments.dto';

export interface InstrumentSearchResult {
  id: number;
  ticker: string | null;
  name: string | null;
  type: string | null;
}

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get('search')
  async search(
    @Query() { q, limit }: SearchInstrumentsDto,
  ): Promise<InstrumentSearchResult[]> {
    const found = await this.instruments.search(q, limit);
    return found.map(({ id, ticker, name, type }) => ({
      id,
      ticker,
      name,
      type,
    }));
  }
}
