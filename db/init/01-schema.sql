-- Schema for the brokerage account database.
-- Equivalent to the schema provided with the challenge: same tables, columns,
-- types and foreign keys. Nothing has been added (no extra constraints or
-- indexes). Unquoted identifiers are folded to lowercase by PostgreSQL, so the
-- physical column names are instrumentid, userid, accountnumber, previousclose.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255),
  accountnumber VARCHAR(20)
);

CREATE TABLE instruments (
  id     SERIAL PRIMARY KEY,
  ticker VARCHAR(10),
  name   VARCHAR(255),
  type   VARCHAR(10)
);

CREATE TABLE orders (
  id           SERIAL PRIMARY KEY,
  instrumentid INT,
  userid       INT,
  size         INT,
  price        NUMERIC(10, 2),
  type         VARCHAR(10),
  side         VARCHAR(10),
  status       VARCHAR(20),
  datetime     TIMESTAMP,
  FOREIGN KEY (instrumentid) REFERENCES instruments (id),
  FOREIGN KEY (userid) REFERENCES users (id)
);

CREATE TABLE marketdata (
  id            SERIAL PRIMARY KEY,
  instrumentid  INT,
  high          NUMERIC(10, 2),
  low           NUMERIC(10, 2),
  open          NUMERIC(10, 2),
  close         NUMERIC(10, 2),
  previousclose NUMERIC(10, 2),
  date          DATE,
  FOREIGN KEY (instrumentid) REFERENCES instruments (id)
);
