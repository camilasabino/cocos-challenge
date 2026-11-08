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
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  new AppExceptionFilter().catch(exception, host);
  return { status, body };
}

describe('AppExceptionFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
});
