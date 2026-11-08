import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DatabaseReadiness, READINESS_TIMEOUT_MS } from './database-readiness';

function readinessWith(query: () => Promise<unknown>): DatabaseReadiness {
  return new DatabaseReadiness({ query } as unknown as DataSource);
}

describe('DatabaseReadiness', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('is ready when SELECT 1 answers', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    await expect(readinessWith(query).isReady()).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('is not ready when the query fails, and logs only a code', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const error = Object.assign(new Error('password for "secret" is wrong'), {
      code: '28P01',
    });

    await expect(
      readinessWith(() => Promise.reject(error)).isReady(),
    ).resolves.toBe(false);
    expect(String(warn.mock.calls[0][0])).toBe(
      'Readiness check failed (28P01)',
    );
  });

  it('is not ready when the database does not answer within the bound', async () => {
    jest.useFakeTimers();
    const result = readinessWith(() => new Promise(() => undefined)).isReady();

    await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);

    await expect(result).resolves.toBe(false);
  });

  it('does not leave its timer pending after a fast answer', async () => {
    jest.useFakeTimers();

    await readinessWith(() => Promise.resolve([])).isReady();

    expect(jest.getTimerCount()).toBe(0);
  });
});
