import { SMALL_POOL_ACQUIRE_TIMEOUT_MS } from './setup/small-pool'; // must stay the first import
import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { fixtureInstrumentId } from './fixtures/instruments';
import { createTestApp } from './setup/create-test-app';
import { insertTestOrders } from './setup/create-test-orders';
import { createTestUser } from './setup/create-test-user';
import {
  cashInOrder,
  countAllOrders,
  orderRowsOf,
  postOrder,
} from './setup/order-requests';
import { resolveTestDatabaseUrl } from './setup/test-database';
import {
  HeldUserLock,
  countBackendsWaitingForUserLock,
  waitUntil,
} from './setup/user-lock';

const ALFA = fixtureInstrumentId('ALFA');

const UNAVAILABLE_BODY = {
  statusCode: 503,
  code: 'SERVICE_UNAVAILABLE',
  message: 'The service is temporarily unavailable',
};

/**
 * Pool of ONE connection: an order waiting on a held user lock occupies it, so
 * other requests must give up after DB_POOL_ACQUIRE_TIMEOUT_MS. A second,
 * independent DataSource drives the database from the outside.
 */
describe('database availability', () => {
  let app: INestApplication;
  let control: DataSource;
  let userId: number;

  const server = () => app.getHttpServer() as Server;

  beforeAll(async () => {
    app = await createTestApp();
    control = new DataSource({
      type: 'postgres',
      url: resolveTestDatabaseUrl(),
    });
    await control.initialize();
  });

  afterAll(async () => {
    await control.destroy();
    await app.close();
  });

  beforeEach(async () => {
    userId = await createTestUser(control);
    await insertTestOrders(control, userId, [cashInOrder(100000)]);
  });

  const buy = () =>
    postOrder(app, {
      userId,
      instrumentId: ALFA,
      side: 'BUY',
      type: 'MARKET',
      size: 1,
    });

  async function occupyThePool(): Promise<{
    lock: HeldUserLock;
    blockedOrder: Promise<request.Response>;
  }> {
    const lock = await HeldUserLock.acquire(control, userId);
    const blockedOrder = buy().then((response) => response);
    await waitUntil(
      async () => (await countBackendsWaitingForUserLock(control)) === 1,
      'the order to wait on the user lock',
    );
    return { lock, blockedOrder };
  }

  it('answers 503 on every endpoint when the pool is exhausted, without waiting forever, then recovers', async () => {
    const { lock, blockedOrder } = await occupyThePool();

    const attempts = [
      () => request(server()).get('/instruments/search?q=alfa'),
      () => request(server()).get(`/users/${userId}/portfolio`),
      () => request(server()).get('/health'),
      () => buy(),
    ];
    for (const attempt of attempts) {
      const startedAt = Date.now();
      const response = await attempt();
      const waited = Date.now() - startedAt;

      expect(response.status).toBe(503);
      expect(response.body).toEqual(UNAVAILABLE_BODY);
      expect(waited).toBeGreaterThanOrEqual(SMALL_POOL_ACQUIRE_TIMEOUT_MS - 50);
      expect(waited).toBeLessThan(SMALL_POOL_ACQUIRE_TIMEOUT_MS + 2000);
    }

    await lock.release();
    expect((await blockedOrder).status).toBe(201);

    await request(server()).get('/health').expect(200);
    await request(server()).get('/instruments/search?q=alfa').expect(200);
    // Only the order that waited on the lock was stored; the 503 ones were not.
    expect(await orderRowsOf(control, userId)).toHaveLength(2);
  });

  it('answers 503 when the database terminates the connection of an in-flight request, persisting nothing', async () => {
    const before = await countAllOrders(control);
    const { lock, blockedOrder } = await occupyThePool();

    await control.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%FROM users%FOR UPDATE%'`,
    );
    const response = await blockedOrder;
    await lock.release();

    expect(response.status).toBe(503);
    expect(response.body).toEqual(UNAVAILABLE_BODY);
    expect(await countAllOrders(control)).toBe(before);

    await request(server()).get('/health').expect(200);
    await buy().expect(201);
  });
});
