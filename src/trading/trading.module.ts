import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstrumentsModule } from '../instruments/instruments.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { Order } from './order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { TradingRepository } from './trading.repository';
import { User } from './user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Order]),
    InstrumentsModule,
    MarketDataModule,
  ],
  controllers: [PortfolioController, OrdersController],
  providers: [PortfolioService, OrdersService, TradingRepository],
})
export class TradingModule {}
