import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstrumentsModule } from '../instruments/instruments.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { OrderPlacementStore } from './orders/order-placement.store';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { Order } from './persistence/order.entity';
import { TradingRepository } from './persistence/trading.repository';
import { TypeOrmOrderPlacementStore } from './persistence/typeorm-order-placement.store';
import { TypeOrmPortfolioReader } from './persistence/typeorm-portfolio.reader';
import { User } from './persistence/user.entity';
import { PortfolioController } from './portfolio/portfolio.controller';
import { PortfolioReader } from './portfolio/portfolio.reader';
import { PortfolioService } from './portfolio/portfolio.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Order]),
    InstrumentsModule,
    MarketDataModule,
  ],
  controllers: [PortfolioController, OrdersController],
  providers: [
    OrdersService,
    PortfolioService,
    // Application-owned ports bound to their TypeORM adapters.
    { provide: OrderPlacementStore, useClass: TypeOrmOrderPlacementStore },
    { provide: PortfolioReader, useClass: TypeOrmPortfolioReader },
    TradingRepository,
  ],
})
export class TradingModule {}
