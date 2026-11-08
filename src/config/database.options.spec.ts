import { buildDatabaseOptions } from './database.options';

describe('buildDatabaseOptions', () => {
  const options = buildDatabaseOptions({
    DATABASE_URL: 'postgresql://user:pw@localhost:5432/cocos',
    DB_POOL_MAX: 7,
    DB_POOL_ACQUIRE_TIMEOUT_MS: 1234,
  });

  it('bounds the pool size and the wait for a connection', () => {
    expect(options).toMatchObject({
      type: 'postgres',
      poolSize: 7,
      connectTimeoutMS: 1234,
    });
  });

  it('never lets TypeORM change the schema', () => {
    expect(options).toMatchObject({
      synchronize: false,
      migrationsRun: false,
    });
  });
});
