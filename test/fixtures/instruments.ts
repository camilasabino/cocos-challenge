export interface InstrumentFixture {
  ticker: string;
  name: string;
  type: 'MONEDA' | 'ACCIONES';
}

/**
 * Deterministic instruments. Ids are assigned by insertion order starting at 1
 * (tables are truncated with RESTART IDENTITY before loading), so use
 * `fixtureInstrumentId` instead of hardcoding numbers in tests.
 *
 * The set is shaped for search/ranking and edge-case scenarios:
 *  - ALFA / ALFAB / BETA: exact ticker, ticker prefix, and name-only match for "alfa"
 *  - GAMA / DELT: names containing the LIKE wildcards "%" and "_"
 *  - NODT: no market data
 *  - SIGM: two market data rows on the same date
 */
export const INSTRUMENT_FIXTURES: readonly InstrumentFixture[] = [
  { ticker: 'ARS', name: 'Peso Argentino', type: 'MONEDA' },
  { ticker: 'ALFA', name: 'Alfa Energía S.A.', type: 'ACCIONES' },
  { ticker: 'ALFAB', name: 'Alfa Bank S.A.', type: 'ACCIONES' },
  { ticker: 'BETA', name: 'Beta Holding de Alfa', type: 'ACCIONES' },
  { ticker: 'GAMA', name: 'Gama 100% Verde S.A.', type: 'ACCIONES' },
  { ticker: 'DELT', name: 'Delta_One S.A.', type: 'ACCIONES' },
  { ticker: 'NODT', name: 'Sin Datos S.A.', type: 'ACCIONES' },
  { ticker: 'SIGM', name: 'Sigma Mercados S.A.', type: 'ACCIONES' },
];

export function fixtureInstrumentId(ticker: string): number {
  const index = INSTRUMENT_FIXTURES.findIndex((i) => i.ticker === ticker);
  if (index === -1) throw new Error(`Unknown fixture instrument: ${ticker}`);
  return index + 1;
}
