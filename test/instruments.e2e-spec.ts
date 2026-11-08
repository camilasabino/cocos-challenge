import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fixtureInstrumentId } from './fixtures/instruments';
import { createTestApp } from './setup/create-test-app';

interface SearchHit {
  id: number;
  ticker: string;
  name: string;
  type: string;
}

describe('GET /instruments/search', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const search = (params: Record<string, string | string[]>) =>
    request(app.getHttpServer() as Server)
      .get('/instruments/search')
      .query(params);

  async function tickers(params: Record<string, string>): Promise<string[]> {
    const response = await search(params).expect(200);
    return (response.body as SearchHit[]).map((hit) => hit.ticker);
  }

  function expectValidationError(body: unknown, field: string): void {
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: expect.any(String) as string,
    });
    const { details } = body as { details: { field: string }[] };
    expect(details.length).toBeGreaterThan(0);
    expect(details.map((detail) => detail.field)).toEqual(
      details.map(() => field),
    );
  }

  describe('matching', () => {
    it('returns id, ticker, name and type for each hit', async () => {
      const response = await search({ q: 'verde' }).expect(200);

      expect(response.body).toEqual([
        {
          id: fixtureInstrumentId('GAMA'),
          ticker: 'GAMA',
          name: 'Gama 100% Verde S.A.',
          type: 'ACCIONES',
        },
      ]);
    });

    it('matches an exact ticker', async () => {
      expect(await tickers({ q: 'beta' })).toEqual(['BETA']);
    });

    it('matches part of a ticker', async () => {
      expect(await tickers({ q: 'lf' })).toEqual(['ALFA', 'ALFAB', 'BETA']);
    });

    it('matches part of a name', async () => {
      expect(await tickers({ q: 'mercados' })).toEqual(['SIGM']);
    });

    it.each(['alfa', 'ALFA', 'aLfA'])('is case-insensitive (%s)', async (q) => {
      expect(await tickers({ q })).toEqual(['ALFA', 'ALFAB', 'BETA']);
    });

    it('ignores surrounding whitespace in the query', async () => {
      expect(await tickers({ q: '  alfa  ' })).toEqual([
        'ALFA',
        'ALFAB',
        'BETA',
      ]);
    });

    it('returns 200 with an empty array when nothing matches', async () => {
      const response = await search({ q: 'zzzz' }).expect(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('ranking', () => {
    it('puts exact ticker, then ticker prefix, then other matches', async () => {
      expect(await tickers({ q: 'alfa' })).toEqual(['ALFA', 'ALFAB', 'BETA']);
    });

    it('ranks an exact ticker above an alphabetically earlier name match', async () => {
      // CORE ("Delt Core") sorts before DELT but only matches by name.
      expect(await tickers({ q: 'delt' })).toEqual(['DELT', 'CORE']);
    });

    it('ranks a ticker prefix above an alphabetically earlier name match', async () => {
      expect(await tickers({ q: 'del' })).toEqual(['DELT', 'CORE']);
    });

    it('orders matches of the same rank by ticker', async () => {
      // SIGM is the only prefix; the rest are substring matches ordered by ticker.
      expect(await tickers({ q: 's' })).toEqual([
        'SIGM',
        'ALFA',
        'ALFAB',
        'BKSL',
        'CORE',
        'DELT',
        'GAMA',
        'NODT',
      ]);
    });

    it('returns the same order on repeated calls', async () => {
      const first = await tickers({ q: 's' });
      const second = await tickers({ q: 's' });
      expect(second).toEqual(first);
    });
  });

  describe('limit', () => {
    it('defaults to 20 results', async () => {
      expect(await tickers({ q: 's' })).toHaveLength(8);
    });

    it('caps the number of results, keeping the best ranked', async () => {
      expect(await tickers({ q: 's', limit: '2' })).toEqual(['SIGM', 'ALFA']);
    });

    it('accepts the maximum limit of 50', async () => {
      await search({ q: 's', limit: '50' }).expect(200);
    });

    it.each(['0', '51', '-1', '1.5', '1e1', 'abc', ''])(
      'rejects invalid limit "%s" with 400',
      async (limit) => {
        const response = await search({ q: 'alfa', limit }).expect(400);
        expectValidationError(response.body, 'limit');
      },
    );
  });

  describe('query validation', () => {
    it.each([
      ['missing', {}],
      ['empty', { q: '' }],
      ['whitespace only', { q: '   ' }],
      ['longer than 50 characters', { q: 'a'.repeat(51) }],
      ['repeated', { q: ['alfa', 'beta'] }],
    ])('rejects a %s q with 400', async (_label, params) => {
      const response = await search(params).expect(400);
      expectValidationError(response.body, 'q');
    });

    it('accepts a q of exactly 50 characters', async () => {
      const response = await search({ q: 'a'.repeat(50) }).expect(200);
      expect(response.body).toEqual([]);
    });

    it('rejects unknown query parameters with 400', async () => {
      const response = await search({ q: 'alfa', offset: '5' }).expect(400);
      expectValidationError(response.body, 'offset');
    });
  });

  describe('LIKE wildcards are matched literally', () => {
    it('treats % as a literal percent sign', async () => {
      expect(await tickers({ q: '%' })).toEqual(['GAMA']);
      expect(await tickers({ q: '100%' })).toEqual(['GAMA']);
    });

    it('treats _ as a literal underscore', async () => {
      expect(await tickers({ q: '_' })).toEqual(['DELT']);
      // As a wildcard, "a_o" would also match "Datos" (NODT).
      expect(await tickers({ q: 'a_o' })).toEqual(['DELT']);
    });

    it('treats a backslash as a literal backslash', async () => {
      expect(await tickers({ q: '\\' })).toEqual(['BKSL']);
      expect(await tickers({ q: 'k\\s' })).toEqual(['BKSL']);
    });

    it('does not treat a trailing backslash as an escape of the wildcard', async () => {
      expect(await tickers({ q: '100\\%' })).toEqual([]);
    });
  });

  describe('safety', () => {
    it('never returns MONEDA instruments', async () => {
      // ARS (MONEDA) matches these by ticker or by name.
      expect(await tickers({ q: 'ars' })).toEqual([]);
      expect(await tickers({ q: 'peso' })).toEqual([]);
      expect(await tickers({ q: 's', limit: '50' })).not.toContain('ARS');
    });

    it('treats SQL syntax in the query as plain text', async () => {
      expect(await tickers({ q: "'; DROP TABLE instruments; --" })).toEqual([]);
      expect(await tickers({ q: 'alfa' })).toEqual(['ALFA', 'ALFAB', 'BETA']);
    });
  });
});
