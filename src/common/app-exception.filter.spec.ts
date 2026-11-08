import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { AppError } from './app-error';
import { AppExceptionFilter } from './app-exception.filter';

function run(exception: unknown): { status: number; body: unknown } {
  let status = 0;
  let body: unknown;
  const response = {
    status(code: number) {
      status = code;
      return { json: (payload: unknown) => (body = payload) };
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', path: '/orders' }),
    }),
  } as unknown as ArgumentsHost;

  new AppExceptionFilter().catch(exception, host);
  return { status, body };
}

describe('AppExceptionFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('renders an AppError with its status, code and details', () => {
    const error = AppError.validation([{ field: 'q', message: 'bad' }]);

    expect(run(error)).toEqual({
      status: 400,
      body: {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'q', message: 'bad' }],
      },
    });
  });

  it('omits details when the error has none', () => {
    const { body } = run(new AppError(404, 'USER_NOT_FOUND', 'User not found'));
    expect(body).toEqual({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  });

  it('maps framework 4xx errors to stable codes', () => {
    expect(run(new HttpException('Cannot GET /x', 404))).toEqual({
      status: 404,
      body: { statusCode: 404, code: 'NOT_FOUND', message: 'Cannot GET /x' },
    });
    expect(run(new HttpException('Bad JSON', 400)).body).toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(run(new HttpException('Nope', 405)).body).toMatchObject({
      code: 'REQUEST_ERROR',
    });
  });

  it('answers unexpected errors with a generic 500 and does not leak details', () => {
    const { status, body } = run(
      new Error('connect ECONNREFUSED postgres://user:s3cret@db/cocos'),
    );

    expect(status).toBe(500);
    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(body)).not.toContain('s3cret');
  });

  it('answers framework 5xx errors with the generic 500 body', () => {
    expect(run(new HttpException('Upstream said: secret', 502)).body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  describe('database availability', () => {
    const unavailable = {
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable',
    };

    /** Mimics QueryFailedError: the driver code is copied and kept in `driverError`. */
    const queryFailed = (code: string) =>
      Object.assign(new Error('query failed'), {
        code,
        driverError: { code },
      });

    it.each([
      ['lock timeout', queryFailed('55P03')],
      ['administrator shutdown', queryFailed('57P01')],
      ['database starting up', queryFailed('57P03')],
      ['connection exception class', queryFailed('08006')],
      [
        'unreachable server',
        Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      ],
      [
        'connection reset',
        Object.assign(new Error('x'), { code: 'ECONNRESET' }),
      ],
      [
        'pool acquisition timeout',
        new Error('timeout exceeded when trying to connect'),
      ],
      ['connection lost', new Error('Connection terminated unexpectedly')],
      [
        'closed pool',
        new Error('Cannot use a pool after calling end on the pool'),
      ],
    ])('answers 503 for %s with the agreed body', (_label, error) => {
      expect(run(error)).toEqual({ status: 503, body: unavailable });
    });

    it('never leaks connection details and logs only a code', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      const error = Object.assign(
        new Error('connect ECONNREFUSED postgres://user:s3cret@db/cocos'),
        { code: 'ECONNREFUSED' },
      );

      const { body } = run(error);

      expect(JSON.stringify(body)).not.toMatch(/s3cret|postgres|ECONNREFUSED/);
      const logged = String(warn.mock.calls[0][0]);
      expect(logged).toBe(
        'Database unavailable (ECONNREFUSED) while handling POST /orders',
      );
      expect(logged).not.toContain('s3cret');
    });

    it.each([
      ['invalid SQL (undefined table)', queryFailed('42P01')],
      ['foreign key violation', queryFailed('23503')],
      ['numeric overflow', queryFailed('22003')],
      ['programming error', new TypeError('x is not a function')],
    ])('keeps %s as a generic 500', (_label, error) => {
      expect(run(error).status).toBe(500);
    });
  });
});
