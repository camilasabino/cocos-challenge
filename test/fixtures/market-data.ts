export interface MarketDataFixture {
  ticker: string;
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  previousClose: string;
}

/**
 * Deterministic market data for two consecutive days. Rows are inserted in
 * array order, so for SIGM the second 2026-11-06 row has the higher id and is
 * the latest price. NODT intentionally has no rows.
 */
export const MARKET_DATA_FIXTURES: readonly MarketDataFixture[] = [
  {
    ticker: 'ALFA',
    date: '2026-11-05',
    open: '100.00',
    high: '104.00',
    low: '99.00',
    close: '102.00',
    previousClose: '100.00',
  },
  {
    ticker: 'ALFAB',
    date: '2026-11-05',
    open: '50.00',
    high: '52.00',
    low: '49.00',
    close: '51.00',
    previousClose: '50.00',
  },
  {
    ticker: 'BETA',
    date: '2026-11-05',
    open: '300.00',
    high: '305.00',
    low: '295.00',
    close: '300.00',
    previousClose: '298.00',
  },
  {
    ticker: 'GAMA',
    date: '2026-11-05',
    open: '10.00',
    high: '11.00',
    low: '9.50',
    close: '10.50',
    previousClose: '10.00',
  },
  {
    ticker: 'DELT',
    date: '2026-11-05',
    open: '20.00',
    high: '21.00',
    low: '19.00',
    close: '20.00',
    previousClose: '19.50',
  },
  {
    ticker: 'SIGM',
    date: '2026-11-05',
    open: '700.00',
    high: '710.00',
    low: '690.00',
    close: '705.00',
    previousClose: '700.00',
  },
  {
    ticker: 'ALFA',
    date: '2026-11-06',
    open: '102.00',
    high: '108.00',
    low: '101.00',
    close: '105.00',
    previousClose: '102.00',
  },
  {
    ticker: 'ALFAB',
    date: '2026-11-06',
    open: '51.00',
    high: '51.50',
    low: '48.00',
    close: '49.50',
    previousClose: '51.00',
  },
  {
    ticker: 'BETA',
    date: '2026-11-06',
    open: '300.00',
    high: '303.00',
    low: '299.00',
    close: '300.00',
    previousClose: '300.00',
  },
  {
    ticker: 'GAMA',
    date: '2026-11-06',
    open: '10.50',
    high: '12.00',
    low: '10.40',
    close: '11.00',
    previousClose: '10.50',
  },
  {
    ticker: 'DELT',
    date: '2026-11-06',
    open: '20.00',
    high: '20.50',
    low: '19.50',
    close: '20.25',
    previousClose: '20.00',
  },
  {
    ticker: 'SIGM',
    date: '2026-11-06',
    open: '705.00',
    high: '712.00',
    low: '700.00',
    close: '708.00',
    previousClose: '705.00',
  },
  {
    ticker: 'SIGM',
    date: '2026-11-06',
    open: '705.00',
    high: '715.00',
    low: '700.00',
    close: '710.50',
    previousClose: '705.00',
  },
];
