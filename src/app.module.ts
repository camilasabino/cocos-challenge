import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDatabaseOptions } from './config/database.options';
import { Env, validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { TradingModule } from './trading/trading.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildDatabaseOptions({
          DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
          DB_POOL_MAX: config.get('DB_POOL_MAX', { infer: true }),
          DB_POOL_ACQUIRE_TIMEOUT_MS: config.get('DB_POOL_ACQUIRE_TIMEOUT_MS', {
            infer: true,
          }),
        }),
    }),
    InstrumentsModule,
    TradingModule,
    HealthModule,
  ],
})
export class AppModule {}
