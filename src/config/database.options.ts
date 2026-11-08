import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Env } from './env';

/**
 * `connectTimeoutMS` is `connectionTimeoutMillis` in `pg`: it bounds both
 * opening a new connection and waiting for a free one once `DB_POOL_MAX` is
 * reached, so an exhausted pool fails requests (503) instead of queueing them
 * without limit.
 */
export function buildDatabaseOptions(
  env: Pick<Env, 'DATABASE_URL' | 'DB_POOL_MAX' | 'DB_POOL_ACQUIRE_TIMEOUT_MS'>,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: env.DATABASE_URL,
    poolSize: env.DB_POOL_MAX,
    connectTimeoutMS: env.DB_POOL_ACQUIRE_TIMEOUT_MS,
    // The schema is owned by db/init/*.sql. TypeORM must never alter it.
    synchronize: false,
    migrationsRun: false,
    autoLoadEntities: true,
  };
}
