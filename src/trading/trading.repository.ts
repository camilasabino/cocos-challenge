import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { parseDecimal } from '../common/decimal';
import { LedgerOrder } from './account-ledger';
import { Order } from './order.entity';
import { OrderSide, OrderStatus, OrderType } from './order.types';
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

/**
 * Persistence access for users and orders. Every method runs on the manager it
 * is given, so callers own the transaction (and therefore the snapshot).
 */
@Injectable()
export class TradingRepository {
  userExists(manager: EntityManager, userId: number): Promise<boolean> {
    return manager.exists(User, { where: { id: userId } });
  }

  /**
   * Orders that affect balances: FILLED (executed) and NEW (reservations).
   * CANCELLED and REJECTED never do, so they are not even fetched.
   *
   * `datetime` is a TIMESTAMP without time zone and the app treats it as UTC.
   * The driver would parse it in the process' local zone, so it is rendered as
   * an explicit UTC ISO string in SQL instead; chronological order (which the
   * cost basis depends on) then cannot vary with the server's time zone.
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
      .addSelect(
        `to_char(o.datetime, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        'datetime',
      )
      .where('o.userId = :userId', { userId })
      .andWhere('o.status IN (:...statuses)', {
        statuses: [OrderStatus.FILLED, OrderStatus.NEW],
      })
      .getRawMany<LedgerOrderRow>();

    return rows.map(toLedgerOrder);
  }
}

/**
 * The schema allows NULLs and free-text values everywhere. A balance-affecting
 * order that cannot be interpreted is a data-integrity problem: failing loudly
 * is safer than computing a wrong portfolio, and data is never "fixed" here.
 */
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
