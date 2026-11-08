import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketData } from './market-data.entity';
import { MarketDataRepository } from './market-data.repository';

@Module({
  imports: [TypeOrmModule.forFeature([MarketData])],
  providers: [MarketDataRepository],
  exports: [MarketDataRepository],
})
export class MarketDataModule {}
