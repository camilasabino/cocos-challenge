/**
 * Classification of PostgreSQL / driver failures that mean "try again later"
 * rather than "the request or the code is wrong". Kept free of TypeORM types:
 * TypeORM copies the driver's fields (`code`) onto its QueryFailedError and also
 * keeps the original under `driverError`, so both are inspected.
 */

/** SQLSTATE `lock_not_available`: `lock_timeout` expired while waiting for a lock. */
const LOCK_NOT_AVAILABLE = '55P03';

/** SQLSTATE values of a server that is shutting down or cannot accept connections. */
const UNAVAILABLE_SQLSTATES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
]);

/** Node socket errors raised when the database cannot be reached or drops the link. */
const UNAVAILABLE_NODE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** `pg` reports these two conditions without any code. */
const UNAVAILABLE_MESSAGES = [
  'Connection terminated',
  'timeout exceeded when trying to connect',
];

export function isLockTimeout(error: unknown): boolean {
  return errorCodes(error).includes(LOCK_NOT_AVAILABLE);
}

/** True when the error is a lock timeout or the database is unreachable. */
export function isTemporarilyUnavailable(error: unknown): boolean {
  if (isLockTimeout(error)) return true;
  if (
    errorCodes(error).some(
      (code) =>
        UNAVAILABLE_SQLSTATES.has(code) ||
        UNAVAILABLE_NODE_CODES.has(code) ||
        code.startsWith('08'), // class 08: connection exception
    )
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return UNAVAILABLE_MESSAGES.some((fragment) => message.includes(fragment));
}

/** Short, value-free label for logs (never the message: it may carry connection details). */
export function describeDatabaseError(error: unknown): string {
  return errorCodes(error)[0] ?? 'unknown';
}

function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string') codes.push(code);
  };
  collect(error);
  if (typeof error === 'object' && error !== null) {
    collect((error as { driverError?: unknown }).driverError);
  }
  return codes;
}
