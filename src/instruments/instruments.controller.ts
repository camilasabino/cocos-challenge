import { Controller, Get, Query } from '@nestjs/common';
import { InstrumentResponse } from './instrument.response';
import { ApiSearchInstruments } from './instruments.api';
import { InstrumentsService } from './instruments.service';
import { SearchInstrumentsDto } from './search-instruments.dto';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get('search')
  @ApiSearchInstruments()
  async search(
    @Query() { q, limit }: SearchInstrumentsDto,
  ): Promise<InstrumentResponse[]> {
    const found = await this.instruments.search(q, limit);
    return found.map(({ id, ticker, name, type }) => ({
      id,
      ticker,
      name,
      type,
    }));
  }
}
