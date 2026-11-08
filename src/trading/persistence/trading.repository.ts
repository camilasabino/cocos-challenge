import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { parseDecimal } from '../../common/decimal';
import { LedgerOrder } from '../domain/account-ledger';
import { Order } from './order.entity';
import { OrderSide, OrderStatus, OrderType } from '../domain/order.types';
import { InsertedOrder, NewOrder } from '../orders/order-placement.store';
import { User } from './user.entity';

interface LedgerOrderRow {
  id: number;
  instrumentId: number | null;
  side: string | null;
  type: string | null;
  status: string | null;
  size: number | null;
  price: string | null;
  datetime: string | null;
}

const UTC_ISO_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`;

@Injectable()
export class TradingRepository {
  userExists(manager: EntityManager, userId: number): Promise<boolean> {
    return manager.exists(User, { where: { id: userId } });
  }

  /** Held until the transaction ends; waits at most `lock_timeout`, then fails with 55P03. */
  async lockUser(manager: EntityManager, userId: number): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    return rows.length > 0;
  }

  /**
   * `datetime` is a TIMESTAMP without time zone, treated as UTC. The driver
   * would parse it in the process' zone, so SQL renders it as a UTC ISO string
   * to keep chronological order independent of the server's time zone.
   */
  async findLedgerOrders(
    manager: EntityManager,
    userId: number,
  ): Promise<LedgerOrder[]> {
    const rows = await manager
      .createQueryBuilder(Order, 'o')
      .select('o.id', 'id')
      .addSelect('o.instrumentId', 'instrumentId')
      .addSelect('o.side', 'side')
      .addSelect('o.type', 'type')
      .addSelect('o.status', 'status')
      .addSelect('o.size', 'size')
      .addSelect('o.price', 'price')
      .addSelect(`to_char(o.datetime, '${UTC_ISO_FORMAT}')`, 'datetime')
      .where('o.userId = :userId', { userId })
      .andWhere('o.status IN (:...statuses)', {
        statuses: [OrderStatus.FILLED, OrderStatus.NEW],
      })
      .getRawMany<LedgerOrderRow>();

    return rows.map(toLedgerOrder);
  }

  /**
   * The UTC timestamp is produced in SQL: a JS Date would be serialized in the
   * Node process' zone and PostgreSQL would silently drop the offset.
   * `clock_timestamp()` (not `now()`, the transaction start) runs after the
   * user lock was granted, so timestamps follow placement order.
   */
  async insertOrder(
    manager: EntityManager,
    order: NewOrder,
  ): Promise<InsertedOrder> {
    const rows: { id: number; datetime: string }[] = await manager.query(
      `INSERT INTO orders (instrumentid, userid, size, price, type, side, status, datetime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp() AT TIME ZONE 'UTC')
       RETURNING id, to_char(datetime, '${UTC_ISO_FORMAT}') AS datetime`,
      [
        order.instrumentId,
        order.userId,
        order.size,
        order.price.toFixed(2),
        order.type,
        order.side,
        order.status,
      ],
    );
    return { id: rows[0].id, datetime: new Date(rows[0].datetime) };
  }
}

/** Fails loudly on uninterpretable rows instead of computing a wrong portfolio. */
function toLedgerOrder(row: LedgerOrderRow): LedgerOrder {
  const invalid = (field: string): Error =>
    new Error(`Order ${row.id} has an invalid or missing ${field}`);

  if (row.instrumentId === null) throw invalid('instrumentid');
  if (row.size === null) throw invalid('size');
  if (row.datetime === null) throw invalid('datetime');

  const datetime = new Date(row.datetime);
  if (Number.isNaN(datetime.getTime())) throw invalid('datetime');

  const side = enumValue(OrderSide, row.side);
  if (!side) throw invalid('side');
  const type = enumValue(OrderType, row.type);
  if (!type) throw invalid('type');
  const status = enumValue(OrderStatus, row.status);
  if (!status) throw invalid('status');

  return {
    id: row.id,
    instrumentId: row.instrumentId,
    side,
    type,
    status,
    size: row.size,
    price: row.price === null ? null : parseDecimal(row.price),
    datetime,
  };
}

function enumValue<T extends string>(
  members: Record<string, T>,
  value: string | null,
): T | undefined {
  return Object.values(members).find((member) => member === value);
}
