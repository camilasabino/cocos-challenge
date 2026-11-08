import { validateEnv } from './env';

const validUrl = 'postgresql://user:s3cret@localhost:5432/cocos';

describe('validateEnv', () => {
  it('applies defaults for optional variables', () => {
    expect(validateEnv({ DATABASE_URL: validUrl })).toEqual({
      DATABASE_URL: validUrl,
      PORT: 3000,
      DB_LOCK_TIMEOUT_MS: 5000,
      DB_POOL_MAX: 10,
      DB_POOL_ACQUIRE_TIMEOUT_MS: 5000,
    });
  });

  it('parses explicit numeric values', () => {
    const env = validateEnv({
      DATABASE_URL: validUrl,
      PORT: '4100',
      DB_LOCK_TIMEOUT_MS: '250',
      DB_POOL_MAX: '20',
      DB_POOL_ACQUIRE_TIMEOUT_MS: '1500',
    });
    expect(env.PORT).toBe(4100);
    expect(env.DB_LOCK_TIMEOUT_MS).toBe(250);
    expect(env.DB_POOL_MAX).toBe(20);
    expect(env.DB_POOL_ACQUIRE_TIMEOUT_MS).toBe(1500);
  });

  it.each([
    ['missing', undefined],
    ['empty', ' '],
    ['non-postgres protocol', 'mysql://u:p@localhost:3306/cocos'],
    ['missing database name', 'postgresql://u:p@localhost:5432'],
    ['not a URL', 'not-a-url'],
  ])('rejects DATABASE_URL when %s', (_label, value) => {
    expect(() => validateEnv({ DATABASE_URL: value })).toThrow(/DATABASE_URL/);
  });

  it.each(['0', '65536', '30.5', 'abc', '-1'])('rejects PORT=%s', (port) => {
    expect(() => validateEnv({ DATABASE_URL: validUrl, PORT: port })).toThrow(
      /PORT/,
    );
  });

  describe('DB_LOCK_TIMEOUT_MS (PostgreSQL int4 milliseconds, 0 disables it)', () => {
    it.each(['1', '5000', '2147483647'])('accepts %s', (value) => {
      expect(
        validateEnv({ DATABASE_URL: validUrl, DB_LOCK_TIMEOUT_MS: value })
          .DB_LOCK_TIMEOUT_MS,
      ).toBe(Number(value));
    });

    it.each([
      '0',
      '-5',
      '1.5',
      'x',
      '2147483648',
      '99999999999999999999999',
      '1e3',
    ])('rejects %s', (value) => {
      expect(() =>
        validateEnv({ DATABASE_URL: validUrl, DB_LOCK_TIMEOUT_MS: value }),
      ).toThrow(
        /DB_LOCK_TIMEOUT_MS must be an integer between 1 and 2147483647/,
      );
    });
  });

  describe.each([
    ['DB_POOL_MAX', '1', '100'],
    ['DB_POOL_ACQUIRE_TIMEOUT_MS', '1', '120000'],
  ])('%s', (name, min, max) => {
    it('accepts its bounds', () => {
      const env = validateEnv({ DATABASE_URL: validUrl, [name]: min });
      expect(env[name as keyof typeof env]).toBe(Number(min));
      expect(
        validateEnv({ DATABASE_URL: validUrl, [name]: max })[
          name as keyof typeof env
        ],
      ).toBe(Number(max));
    });

    it.each(['0', '-1', '1.5', 'abc', String(Number(max) + 1)])(
      'rejects %s',
      (value) => {
        expect(() =>
          validateEnv({ DATABASE_URL: validUrl, [name]: value }),
        ).toThrow(
          new RegExp(`${name} must be an integer between ${min} and ${max}`),
        );
      },
    );
  });

  it('reports every invalid setting at once', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: validUrl,
        DB_LOCK_TIMEOUT_MS: '0',
        DB_POOL_MAX: '0',
      }),
    ).toThrow(/DB_LOCK_TIMEOUT_MS[\s\S]*DB_POOL_MAX/);
  });

  it('never includes credentials in error messages', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'mysql://user:s3cret@localhost/cocos',
        PORT: 'bad',
      }),
    ).toThrow(/^(?![\s\S]*s3cret)/);
  });
});
