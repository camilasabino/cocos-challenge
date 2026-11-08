# Cocos Challenge — Brokerage API

REST API for a brokerage account: portfolio valuation, instrument search and order placement. It is the solution to the Cocos Capital backend challenge.

- **Stack:** Node.js 22, TypeScript, NestJS 11, TypeORM, PostgreSQL 16, `decimal.js`, `class-validator`, `@nestjs/swagger`.
- **Database:** the schema provided with the challenge, unchanged. The application never alters it (`synchronize` and `migrationsRun` are off).

| Endpoint                         | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `GET /instruments/search`        | Search instruments by ticker and/or name                      |
| `GET /users/:userId/portfolio`   | Account value, available cash, positions and returns          |
| `POST /orders`                   | Place a MARKET or LIMIT, BUY or SELL order                    |
| `GET /health`                    | Readiness check (PostgreSQL reachable). Not part of the business API |
| `GET /api`, `GET /api-json`      | Swagger UI and the OpenAPI document                           |

## Getting started

Prerequisites: Node.js 22 (see `.nvmrc`) and Docker with Compose v2.

```sh
cp .env.example .env     # throwaway local credentials; .env is git-ignored
npm install
npm run db:up            # PostgreSQL 16, waits until healthy
npm run start:dev        # http://localhost:3000 (set PORT in .env if 3000 is taken)
```

`npm run db:up` creates two databases the first time its volume is initialized (scripts in `db/init/`):

| Database     | Contents                                                | Used by                 |
| ------------ | ------------------------------------------------------- | ----------------------- |
| `cocos`      | Schema + synthetic demo data (`02-demo-seed.sql`)       | the app (`DATABASE_URL`) |
| `cocos_test` | Schema only; fixtures are loaded by the tests           | tests (`TEST_DATABASE_URL`) |

Reset everything with `docker compose down -v && npm run db:up`. `npm run db:down` stops the database and keeps its data.

### Configuration

Environment variables are validated at startup; invalid values abort the boot with a message that never echoes secrets.

| Variable                      | Default | Description                                                                                      |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                | —       | PostgreSQL URL (required). Any PostgreSQL server works, local or hosted.                         |
| `PORT`                        | `3000`  | HTTP port (1–65535)                                                                              |
| `DB_LOCK_TIMEOUT_MS`          | `5000`  | Max wait for the per-user lock when placing an order. 1–2147483647 (PostgreSQL's `lock_timeout` range; `0` would disable it, so it is rejected) |
| `DB_POOL_MAX`                 | `10`    | Maximum pooled connections (1–100)                                                               |
| `DB_POOL_ACQUIRE_TIMEOUT_MS`  | `5000`  | Max wait for a free connection or to open one (1–120000); then the request fails with 503        |
| `TEST_DATABASE_URL`           | —       | Tests only; must target `cocos_test` on localhost                                                |

Pool trade-off: an order waiting for the user lock keeps its connection, so a burst of orders for one user can occupy the pool. The bounds make that fail fast with 503 rather than queue indefinitely; raise `DB_POOL_MAX` only if the database's connection limit allows it (hosted databases often allow few).

### Scripts

| Command                       | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `npm run build` / `start`     | Compile to `dist/` / run (`start:dev` watches)          |
| `npm run lint`, `format:check`| ESLint (including the architecture guard) / Prettier    |
| `npm test`                    | Unit tests (no database)                                |
| `npm run test:e2e`            | Functional tests against `cocos_test` (needs `db:up`)   |

### Docker

A multi-stage image (Node 22 Alpine; build stage, production-only dependencies, compiled `dist/` only) that runs as the unprivileged `node` user with `node dist/main` as PID 1, so SIGTERM reaches Nest's shutdown hooks. It contains no sources, tests, docs or `.env`; the build context is allow-listed in `.dockerignore`. Configuration is environment-only.

Against the Compose database (inside the Compose network PostgreSQL is `postgres:5432`, not `localhost`):

```sh
npm run db:up
APP_PORT=3000 docker compose --profile app up --build -d --wait   # APP_PORT: host port (default 3000)
curl localhost:3000/health
docker compose --profile app down app
```

Standalone, against any PostgreSQL reachable from the container (`host.docker.internal` reaches a database published on the host in Docker Desktop):

```sh
docker build -t cocos-challenge .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME cocos-challenge
```

The base image tag floats within Node 22 (`NODE_VERSION` build arg); dependencies are lockfile-exact (`npm ci`). `docker stop` lets in-flight requests finish and closes the pool before exiting with code 0.

## API

Interactive documentation: **Swagger UI at `/api`**, OpenAPI JSON at `/api-json`. Errors always have the shape `{ "statusCode", "code", "message", "details"? }`.

### Instrument search

`GET /instruments/search?q=norte&limit=5` — case-insensitive substring on ticker OR name; ranked exact ticker, ticker prefix, then other matches. `limit` 1–50 (default 20). Cash (`MONEDA`) is never returned. No match → `200 []`.

```json
[{ "id": 2, "ticker": "NRTE", "name": "Norte Energía S.A.", "type": "ACCIONES" }]
```

### Portfolio

`GET /users/1/portfolio`

```json
{
  "userId": 1,
  "totalAccountValue": "1857690.00",
  "cashBalance": "1609400.00",
  "availableCash": "1585400.00",
  "valuationComplete": true,
  "unpricedInstrumentIds": [],
  "positions": [
    {
      "instrumentId": 2, "ticker": "NRTE", "name": "Norte Energía S.A.", "quantity": 90,
      "lastPrice": "1050.00", "marketValue": "94500.00", "averageCost": "1003.33",
      "totalReturnPercent": "4.65", "dailyPriceChangePercent": "2.94"
    }
  ]
}
```

(positions abbreviated). `400` invalid id, `404 USER_NOT_FOUND`.

### Place an order

`POST /orders`. **Writes to the database.**

```json
{ "userId": 1, "instrumentId": 2, "side": "BUY", "type": "LIMIT", "amount": "10000.00", "price": "1000.00" }
```

- `side`: `BUY` | `SELL`. `type`: `MARKET` (no `price`) | `LIMIT` (`price` required).
- Exactly one of `size` (whole shares) or `amount` (ARS; shares = `floor(amount / price)`).
- `amount` and `price` are decimal strings, > 0, at most 2 decimals, ≤ 99999999.99; they are rejected, never rounded.

```json
{ "id": 15, "userId": 1, "instrumentId": 2, "side": "BUY", "type": "LIMIT", "status": "NEW",
  "size": 10, "price": "1000.00", "datetime": "2026-11-08T15:04:05.123Z", "rejectionReason": null }
```

| HTTP | Meaning                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------- |
| 201  | Order persisted as `FILLED` (MARKET), `NEW` (LIMIT) or `REJECTED` (`rejectionReason`: `INSUFFICIENT_FUNDS` / `INSUFFICIENT_SHARES`) |
| 400  | `VALIDATION_ERROR` (cross-field rules, unknown fields, `CASH_IN`/`CASH_OUT` sides, …)                             |
| 404  | `USER_NOT_FOUND`, `INSTRUMENT_NOT_FOUND`                                                                         |
| 422  | `INSTRUMENT_NOT_TRADABLE`, `PRICE_UNAVAILABLE`, `ZERO_QUANTITY`, `QUANTITY_OUT_OF_RANGE`                          |
| 503  | `SERVICE_UNAVAILABLE`                                                                                            |

Only 201 persists. 4xx responses never write.

### Health

`GET /health` → `200 {"status":"ok"}` when a pooled connection can be obtained and `SELECT 1` answers within 2 seconds; otherwise `503 SERVICE_UNAVAILABLE`. It is a **readiness** check (it also fails when the pool is exhausted), not liveness, and exposes no connection details.

### Collections

- **Postman:** import `postman/cocos-challenge.postman_collection.json` (Postman → Import). Set the `baseUrl` collection variable if the API is not on `localhost:3000`. Requests are grouped by feature, carry `pm.test` assertions, and those that write are labeled "MODIFIES DATABASE STATE". Run the folder with the Collection Runner. IDs follow the demo database; against another dataset, look them up with the search requests and edit the variables.
- **REST Client:** open `requests.http` in VS Code with the REST Client extension and click *Send Request*; `@baseUrl` and `@userId` are variables at the top.

Both write to the database they target. To keep the demo data clean, point the app at a disposable database or reset it with `docker compose down -v && npm run db:up`.

## Architecture

NestJS modules organized by capability:

```
src/
  instruments/   search use case, repository
  market-data/   latest-price repository
  trading/
    domain/      pure financial rules (no Nest/TypeORM): ledger, sizing, order decision, valuation
    orders/      POST /orders: controller, DTO, service, OrderPlacementStore port
    portfolio/   GET portfolio: controller, service, PortfolioReader port
    persistence/ TypeORM adapters for both ports, repositories, entities
  health/        readiness probe
  common/        Decimal helpers, error contract, exception filter
  config/        validated environment, database options
```

- **Domain** is framework-free and unit tested; every money computation uses `decimal.js`, never floats. Rounding (half-up, 2 decimals) happens only when building responses.
- **Application services** own the workflow and business-rule checks. They depend on two application-owned ports (`OrderPlacementStore`, `PortfolioReader`), not on TypeORM, SQL or driver errors. An ESLint rule enforces these boundaries.
- **Adapters** (`trading/persistence`) hold the transaction mechanics: isolation levels, `lock_timeout`, the `QueryRunner` lifecycle and SQL. Entities never leave them.
- **Errors:** one exception filter turns application errors into the error contract and database availability failures into 503; unexpected errors become a generic 500 with nothing leaked.
- **Trade-offs:** ports exist only where use cases need a transactional boundary (no generic repositories); the ledger is folded in memory per request instead of materialized positions, because the schema is not modified (O(orders of the user)); the `orders` table has no index on `userid` (schema unchanged), which is fine at this scale.

## Financial and business rules

- **Cash balance** = FILLED `CASH_IN` − `CASH_OUT` − BUY (`size × price`) + SELL (`size × price`). Cash orders use `size` as the ARS amount.
- **Available cash** = cash balance − cash reserved by open (`NEW`) BUY orders. **Available shares** = held − shares reserved by open (`NEW`) SELL orders. Reservations are an assumption (not stated by the challenge).
- **Positions** use FILLED orders only: BUY − SELL. `NEW`, `REJECTED` and `CANCELLED` orders do not change holdings or cash balance. Closed positions are omitted.
- **MARKET** orders execute immediately at the latest `close` and are `FILLED`. **LIMIT** orders are stored as `NEW` at the requested price; the system never fills them (no market simulation). LIMIT orders that already exist as `FILLED` in the data are treated as executed.
- **Latest price:** the row with the most recent `date` (ties: highest `id`). A latest row without `close` counts as no price (older rows are not used); a MARKET order needs a positive price.
- **Order sizing:** `floor(amount / price)` with decimals (MARKET: latest close; LIMIT: limit price). Zero shares → `422 ZERO_QUANTITY`. More than 2147483647 shares (the `INT` column) → 422, or 400 when `size` itself is given.
- **Validation:** a BUY larger than available cash, or a SELL larger than available shares, is persisted as `REJECTED` and answered with 201.
- **Weighted-average cost:** FILLED orders processed chronologically (`datetime`, then `id`). BUY adds `size × price`; a SELL removes cost proportionally (the average does not change); a position closed to zero resets.
- **Total return** = (market value − cost basis) / cost basis × 100: the unrealized return of the current position. **`dailyPriceChangePercent`** = (`close` − `previousClose`) / `previousClose` × 100: the instrument's price change, not the investment's.
- **Portfolio value** = cash balance + Σ market value. **Missing prices:** if a held instrument has no price, its price-derived fields and `totalAccountValue` are `null` and `valuationComplete` is `false`; a partial total is never returned as complete.
- **Historical negative positions:** the supplied data contains a SELL larger than the holding (user 1, BMA: −10). Data is never corrected: the position is listed with a negative quantity and market value (included in the total, as the cash already includes the sale), and its `averageCost` and `totalReturnPercent` are `null`. The API never creates new ones: further SELLs are rejected.
- **Cash instruments** (`MONEDA`) are not tradable or searchable; `CASH_IN`/`CASH_OUT` are not accepted sides.
- **Verified on the original dataset** (loaded locally from the challenge's `database.sql`): user 1 → cash `753000.00`, available `627500.00`, total `889756.00`; PAMP 40, BMA −10, METR 500.

## Reliability

- **Order placement** runs in one `READ COMMITTED` transaction: lock the user row (`SELECT … FOR UPDATE`, bounded by `lock_timeout`), resolve price and quantity, rebuild the ledger, decide, insert. Placements for the same user are serialized across processes, so concurrent orders cannot overspend; different users do not block each other. `READ COMMITTED` is deliberate: after waiting for the lock each statement must see what the previous holder committed. Errors roll back; a `REJECTED` order is a normal outcome and is committed.
- **Portfolio reads** run in one `REPEATABLE READ`, read-only transaction: all queries see the same snapshot, take no row locks and never block order placement.
- **Timestamps** are stored in UTC: `orders.datetime` (`TIMESTAMP` without zone) is written in SQL with `clock_timestamp() AT TIME ZONE 'UTC'` after the lock is granted, so it follows serialization order, and read back as UTC ISO-8601 (`Z`) regardless of the server's or session's time zone.
- **Database availability:** unreachable PostgreSQL, lost connections, pool acquisition timeout, lock timeout and server shutdown codes all answer `503 SERVICE_UNAVAILABLE` ("The service is temporarily unavailable") on every endpoint. Invalid SQL, programming and data-integrity errors stay 500. Requests never wait indefinitely for the pool.
- **Uncertain outcomes:** if the connection fails *during COMMIT*, whether the order was stored is unknown. There are no idempotency keys, so retrying a `POST /orders` after a 503 or a lost response may create a duplicate order.
- **Graceful shutdown:** on SIGTERM/SIGINT the server stops accepting connections, in-flight requests (including an order waiting for the lock) finish, then the pool is closed. Verified with a local process and with `docker stop` (exit code 0, no connections left in `pg_stat_activity`).

## Quality

- **Tests:** 249 unit tests (pure financial rules, DTO validation, configuration, error classification, readiness) and 199 functional tests run through the real app against PostgreSQL (`cocos_test`): order placement incl. rollback, concurrency and lock queueing, UTC timestamps under non-UTC time zones, portfolio snapshot and query budget, search, health, pool exhaustion and terminated connections, and the generated OpenAPI document. Run `npm test` and `npm run test:e2e`.
- **Test database isolation:** tests refuse to run unless `TEST_DATABASE_URL` is a `cocos_test` database on localhost and `current_database()` confirms it; the demo database is never touched.
- **CI** (`.github/workflows/ci.yml`): format check, ESLint, build, unit tests and e2e tests against a PostgreSQL 16 service container; and a job that builds the production image (no push) and checks it runs as non-root with no private files.
- **Docker verification** (local): image build; container against PostgreSQL over a Docker network; all endpoints, Swagger UI and `/api-json` from the running container; non-root user; fail-fast without `DATABASE_URL`; PostgreSQL stopped and restarted under a running container (503, then recovery); `docker stop` with an in-flight order.
- **Original dataset:** compatibility with the challenge's `database.sql` was checked on a disposable local database: identical tables, columns, types, nullability and keys; search, portfolio and order placement behave as documented.
- **Dependency security** (`npm audit --omit=dev`): 5 advisories remain, all transitive and reported against `multer` (via `@nestjs/platform-express`) and `glob`/`minimatch` (via `typeorm`). They are not reachable here: the API accepts no multipart uploads (the `multer` flaw needs a file filter), and TypeORM's glob use applies to entity/migration path patterns, which this app does not use (entities are registered explicitly). No compatible fix exists: they require NestJS 12 / TypeORM 1.x majors. Accepted as residual risk and left unchanged. `npm audit fix --force` was not run.

## Limitations

- **No authentication or authorization:** any caller can act for any `userId`.
- **No market simulation:** LIMIT orders stay `NEW`; there is no automatic matching and no cancellation endpoint.
- **No idempotency keys:** retries after an uncertain write outcome may duplicate orders.
- Search is a substring `ILIKE` scan (no fuzzy or accent-insensitive search); ticker ordering uses the database collation.
- Reservations by `NEW` orders and the weighted-average cost method are documented assumptions.
- Reading a user's ledger is O(orders) per request and unindexed; fine at challenge scale.
- Per-user serialization uses a database row lock, so it holds across several instances of the app.
- **Hosted Neon database: not verified.** The app accepts any PostgreSQL through `DATABASE_URL` (including connection pooling settings above), and compatibility was verified against a local PostgreSQL copy of the original dataset only. Live connectivity to Neon (TLS parameters, pooler behavior with transactions and `lock_timeout`) has not been tested.
- Basic logging only (no metrics or tracing). This is a challenge solution, not a production brokerage system.
