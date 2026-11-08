import { resolveTestDatabaseUrl } from './setup/test-database';

const url = (database: string, host = 'localhost') =>
  `postgresql://user:s3cret@${host}:5432/${database}`;

describe('test database guard', () => {
  it('accepts the local cocos_test database', () => {
    const value = url('cocos_test');
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: value })).toBe(value);
    expect(
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: url('cocos_test', '127.0.0.1'),
      }),
    ).toBeDefined();
  });

  it.each([
    ['the demo database', url('cocos')],
    ['a database with a similar name', url('cocos_test_2')],
    ['a remote host', url('cocos_test', 'db.example.com')],
    ['an invalid URL', 'not-a-url'],
    ['a missing value', ''],
  ])('refuses %s', (_label, value) => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: value }),
    ).toThrow();
  });

  it('refuses when TEST_DATABASE_URL is not set', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(/TEST_DATABASE_URL/);
  });

  it('never leaks credentials in error messages', () => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: url('cocos') }),
    ).toThrow(/^(?![\s\S]*s3cret)/);
  });
});
