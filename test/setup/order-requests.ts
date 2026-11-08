import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { OrderResponse } from '../../src/trading/orders/order.response';
import type { PortfolioResponse } from '../../src/trading/portfolio/portfolio.response';

/** Ordinary `POST /orders`; the body is deliberately untyped so tests can send invalid ones. */
export function postOrder(app: INestApplication, body?: unknown) {
  return request(app.getHttpServer() as Server)
    .post('/orders')
    .send(body as object);
}

export async function getPortfolio(
  app: INestApplication,
  userId: number,
): Promise<PortfolioResponse> {
  const response = await request(app.getHttpServer() as Server)
    .get(`/users/${userId}/portfolio`)
    .expect(200);
  return response.body as PortfolioResponse;
}

export type { OrderResponse };

/** Raw `orders` row; `datetime` is the stored UTC wall clock as an ISO string with `Z`. */
export interface OrderRow {
  id: number;
  instrumentid: number;
  userid: number;
  size: number;
  price: string;
  type: string;
  side: string;
  status: string;
  datetime: string;
}

export async function orderRowsOf(
  dataSource: DataSource,
  userId: number,
): Promise<OrderRow[]> {
  return dataSource.query<OrderRow[]>(
    `SELECT id, instrumentid, userid, size, price, type, side, status,
            to_char(datetime, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS datetime
       FROM orders WHERE userid = $1 ORDER BY id`,
    [userId],
  );
}

export async function countAllOrders(dataSource: DataSource): Promise<number> {
  const [{ count }] = await dataSource.query<{ count: string }[]>(
    'SELECT count(*) AS count FROM orders',
  );
  return Number(count);
}

/** Cash deposit rows as the demo data stores them (`size` = ARS, `price` = 1). */
export const cashInOrder = (size: number, datetime = '2026-11-02 10:00:00') =>
  ({
    ticker: 'ARS',
    side: 'CASH_IN',
    size,
    price: '1.00',
    datetime,
  }) as const;
