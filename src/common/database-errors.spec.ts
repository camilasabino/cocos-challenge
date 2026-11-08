import {
  describeDatabaseError,
  isLockTimeout,
  isTemporarilyUnavailable,
} from './database-errors';

/** Mimics TypeORM's QueryFailedError: driver fields are copied onto the error and kept in `driverError`. */
function queryFailed(code: string): Error {
  const driverError = Object.assign(new Error('driver message'), { code });
  return Object.assign(new Error('query failed'), { code, driverError });
}

describe('database error classification', () => {
  it('recognizes a lock timeout (SQLSTATE 55P03)', () => {
    expect(isLockTimeout(queryFailed('55P03'))).toBe(true);
    expect(isTemporarilyUnavailable(queryFailed('55P03'))).toBe(true);
  });

  it('finds the code on driverError when it is not copied to the wrapper', () => {
    const wrapped = Object.assign(new Error('query failed'), {
      driverError: { code: '55P03' },
    });

    expect(isLockTimeout(wrapped)).toBe(true);
  });

  it.each(['57P01', '57P02', '57P03', '53300', '08006', '08001'])(
    'treats SQLSTATE %s as temporary unavailability',
    (code) => {
      expect(isTemporarilyUnavailable(queryFailed(code))).toBe(true);
      expect(isLockTimeout(queryFailed(code))).toBe(false);
    },
  );

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'])(
    'treats the socket error %s as temporary unavailability',
    (code) => {
      expect(
        isTemporarilyUnavailable(Object.assign(new Error('x'), { code })),
      ).toBe(true);
    },
  );

  it.each([
    'Connection terminated unexpectedly',
    'timeout exceeded when trying to connect',
  ])('treats the pg message "%s" as temporary unavailability', (message) => {
    expect(isTemporarilyUnavailable(new Error(message))).toBe(true);
  });

  it.each(['23503', '22003', '42P01', '23505'])(
    'does not hide the data or code error SQLSTATE %s',
    (code) => {
      expect(isTemporarilyUnavailable(queryFailed(code))).toBe(false);
    },
  );

  it('ignores errors without codes and non-error values', () => {
    expect(isTemporarilyUnavailable(new Error('boom'))).toBe(false);
    expect(isTemporarilyUnavailable('55P03')).toBe(false);
    expect(isTemporarilyUnavailable(null)).toBe(false);
    expect(isLockTimeout(undefined)).toBe(false);
  });

  it('describes an error by code only, never by message', () => {
    const error = queryFailed('55P03');
    error.message = 'password authentication failed for user "secret"';

    expect(describeDatabaseError(error)).toBe('55P03');
    expect(describeDatabaseError(new Error('boom'))).toBe('unknown');
  });
});
