import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Env, validateEnv } from './config/env';
import { InstrumentsModule } from './instruments/instruments.module';
import { TradingModule } from './trading/trading.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL', { infer: true }),
        // The schema is owned by db/init/*.sql. TypeORM must never alter it.
        synchronize: false,
        migrationsRun: false,
        // Entities are registered explicitly by each feature module via
        // TypeOrmModule.forFeature([...]); no glob scanning.
        autoLoadEntities: true,
      }),
    }),
    InstrumentsModule,
    TradingModule,
  ],
})
export class AppModule {}
