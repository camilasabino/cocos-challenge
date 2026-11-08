import { validateEnv } from './env';

const validUrl = 'postgresql://user:s3cret@localhost:5432/cocos';

describe('validateEnv', () => {
  it('applies defaults for optional variables', () => {
    expect(validateEnv({ DATABASE_URL: validUrl })).toEqual({
      DATABASE_URL: validUrl,
      PORT: 3000,
      DB_LOCK_TIMEOUT_MS: 5000,
    });
  });

  it('parses explicit numeric values', () => {
    const env = validateEnv({
      DATABASE_URL: validUrl,
      PORT: '4100',
      DB_LOCK_TIMEOUT_MS: '250',
    });
    expect(env.PORT).toBe(4100);
    expect(env.DB_LOCK_TIMEOUT_MS).toBe(250);
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

  it.each(['0', '-5', '1.5', 'x'])('rejects DB_LOCK_TIMEOUT_MS=%s', (value) => {
    expect(() =>
      validateEnv({ DATABASE_URL: validUrl, DB_LOCK_TIMEOUT_MS: value }),
    ).toThrow(/DB_LOCK_TIMEOUT_MS/);
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
