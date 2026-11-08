-- Synthetic demo data for the `cocos` database. Entirely fictional: companies,
-- tickers, prices, users and e-mail addresses are made up (example.com).
-- Applied only to `cocos`; the test database `cocos_test` is schema-only.
--
-- Rows are inserted in a fixed order, so serial ids are deterministic on a
-- fresh database. The data deliberately covers the edge cases the API must
-- handle:
--   * a MONEDA instrument (ARS) that is neither tradable nor searchable
--   * instrument TERR has no market data (unpriced position scenario)
--   * instrument SOLA has two market data rows on the same date (the row
--     with the highest id must be used as the latest price)
--   * user 20001: cash in/out, several FILLED buys, a partial sell, a
--     LIMIT order that is FILLED, NEW LIMIT orders (reservations), a
--     CANCELLED order and a REJECTED order
--   * user 20002: no orders at all
--   * user 20003: sold more than they held (negative position in LUMI)

INSERT INTO users (email, accountnumber) VALUES
  ('demo.active@example.com',    '20001'),
  ('demo.empty@example.com',     '20002'),
  ('demo.oversold@example.com',  '20003');

INSERT INTO instruments (ticker, name, type) VALUES
  ('ARS',  'Peso Argentino',          'MONEDA'),
  ('NRTE', 'Norte Energía S.A.',      'ACCIONES'),
  ('NRTX', 'Norte Textil S.A.',       'ACCIONES'),
  ('SOLA', 'Sol Agro S.A.',           'ACCIONES'),
  ('LUMI', 'Lumina Telecom S.A.',     'ACCIONES'),
  ('MARB', 'Banco del Mar S.A.',      'ACCIONES'),
  ('TERR', 'Terra Inmobiliaria S.A.', 'ACCIONES'),
  ('ANDI', 'Andina Minera S.A.',      'ACCIONES');

-- Market data for two consecutive days. TERR intentionally has none.
INSERT INTO marketdata (instrumentid, high, low, open, close, previousclose, date) VALUES
  ((SELECT id FROM instruments WHERE ticker = 'NRTE'), 1030.00,  995.00, 1000.00, 1020.00, 1000.00, '2026-11-05'),
  ((SELECT id FROM instruments WHERE ticker = 'NRTX'),  415.00,  400.00,  405.00,  410.00,  405.00, '2026-11-05'),
  ((SELECT id FROM instruments WHERE ticker = 'SOLA'),  252.00,  247.00,  248.00,  250.50,  248.00, '2026-11-05'),
  ((SELECT id FROM instruments WHERE ticker = 'LUMI'), 1810.00, 1780.00, 1790.00, 1800.00, 1790.00, '2026-11-05'),
  ((SELECT id FROM instruments WHERE ticker = 'MARB'), 3220.00, 3140.00, 3150.00, 3200.00, 3150.00, '2026-11-05'),
  ((SELECT id FROM instruments WHERE ticker = 'ANDI'),   91.00,   88.00,   88.50,   90.00,   88.50, '2026-11-05'),
  ((SELECT id FROM instruments WHERE ticker = 'NRTE'), 1060.00, 1015.00, 1020.00, 1050.00, 1020.00, '2026-11-06'),
  ((SELECT id FROM instruments WHERE ticker = 'NRTX'),  412.00,  398.00,  410.00,  400.00,  410.00, '2026-11-06'),
  -- Two rows for the same instrument and date: the second one (higher id) is the latest.
  ((SELECT id FROM instruments WHERE ticker = 'SOLA'),  256.00,  250.00,  250.50,  255.00,  250.50, '2026-11-06'),
  ((SELECT id FROM instruments WHERE ticker = 'SOLA'),  257.00,  250.00,  250.50,  256.25,  250.50, '2026-11-06'),
  ((SELECT id FROM instruments WHERE ticker = 'LUMI'), 1805.00, 1770.00, 1800.00, 1775.50, 1800.00, '2026-11-06'),
  ((SELECT id FROM instruments WHERE ticker = 'MARB'), 3270.00, 3195.00, 3200.00, 3250.75, 3200.00, '2026-11-06'),
  ((SELECT id FROM instruments WHERE ticker = 'ANDI'),   93.00,   89.50,   90.00,   92.40,   90.00, '2026-11-06');

-- Orders. Cash movements use the ARS instrument with size = amount in pesos
-- and price = 1.
INSERT INTO orders (instrumentid, userid, size, price, type, side, status, datetime) VALUES
  -- User 20001 (active)
  ((SELECT id FROM instruments WHERE ticker = 'ARS'),  (SELECT id FROM users WHERE accountnumber = '20001'), 2000000,    1.00, 'MARKET', 'CASH_IN',  'FILLED',    '2026-11-02 10:00:00'),
  ((SELECT id FROM instruments WHERE ticker = 'ARS'),  (SELECT id FROM users WHERE accountnumber = '20001'),  150000,    1.00, 'MARKET', 'CASH_OUT', 'FILLED',    '2026-11-03 09:30:00'),
  ((SELECT id FROM instruments WHERE ticker = 'NRTE'), (SELECT id FROM users WHERE accountnumber = '20001'),     100, 1000.00, 'MARKET', 'BUY',      'FILLED',    '2026-11-03 11:00:00'),
  ((SELECT id FROM instruments WHERE ticker = 'LUMI'), (SELECT id FROM users WHERE accountnumber = '20001'),      50, 1790.00, 'MARKET', 'BUY',      'FILLED',    '2026-11-03 11:05:00'),
  ((SELECT id FROM instruments WHERE ticker = 'NRTE'), (SELECT id FROM users WHERE accountnumber = '20001'),      50, 1010.00, 'MARKET', 'BUY',      'FILLED',    '2026-11-04 10:15:00'),
  ((SELECT id FROM instruments WHERE ticker = 'MARB'), (SELECT id FROM users WHERE accountnumber = '20001'),      20, 3150.00, 'LIMIT',  'BUY',      'FILLED',    '2026-11-04 14:00:00'),
  ((SELECT id FROM instruments WHERE ticker = 'NRTX'), (SELECT id FROM users WHERE accountnumber = '20001'),     100,  395.00, 'LIMIT',  'BUY',      'CANCELLED', '2026-11-05 12:00:00'),
  ((SELECT id FROM instruments WHERE ticker = 'NRTE'), (SELECT id FROM users WHERE accountnumber = '20001'),      60, 1040.00, 'MARKET', 'SELL',     'FILLED',    '2026-11-05 15:00:00'),
  ((SELECT id FROM instruments WHERE ticker = 'MARB'), (SELECT id FROM users WHERE accountnumber = '20001'),     600, 3250.75, 'MARKET', 'BUY',      'REJECTED',  '2026-11-06 09:45:00'),
  ((SELECT id FROM instruments WHERE ticker = 'SOLA'), (SELECT id FROM users WHERE accountnumber = '20001'),     100,  240.00, 'LIMIT',  'BUY',      'NEW',       '2026-11-06 10:00:00'),
  ((SELECT id FROM instruments WHERE ticker = 'LUMI'), (SELECT id FROM users WHERE accountnumber = '20001'),      20, 1900.00, 'LIMIT',  'SELL',     'NEW',       '2026-11-06 10:30:00'),
  -- User 20003 (oversold: bought 20, sold 30 => -10 LUMI)
  ((SELECT id FROM instruments WHERE ticker = 'ARS'),  (SELECT id FROM users WHERE accountnumber = '20003'),  500000,    1.00, 'MARKET', 'CASH_IN',  'FILLED',    '2026-11-03 10:00:00'),
  ((SELECT id FROM instruments WHERE ticker = 'LUMI'), (SELECT id FROM users WHERE accountnumber = '20003'),      20, 1790.00, 'MARKET', 'BUY',      'FILLED',    '2026-11-04 10:00:00'),
  ((SELECT id FROM instruments WHERE ticker = 'LUMI'), (SELECT id FROM users WHERE accountnumber = '20003'),      30, 1800.00, 'MARKET', 'SELL',     'FILLED',    '2026-11-05 10:00:00');
