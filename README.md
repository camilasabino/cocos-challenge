# Cocos Challenge — Brokerage API

A REST API for portfolio valuation, instrument search, and order placement, built for the [Cocos Capital backend challenge](https://github.com/cocoscap/cocos-challenge/blob/main/backend-challenge.md).

**Stack:** Node.js 22, TypeScript, NestJS 11, TypeORM, PostgreSQL 16, Decimal.js, Jest, and Swagger/OpenAPI.

| Endpoint | Description |
| --- | --- |
| `GET /instruments/search` | Search instruments by ticker or name |
| `GET /users/:userId/portfolio` | Account value, available cash, holdings, and returns |
| `POST /orders` | Submit MARKET or LIMIT, BUY or SELL orders |
| `GET /health` | PostgreSQL readiness check |

**API documentation:** [Swagger UI](http://localhost:3000/api) · [OpenAPI JSON](http://localhost:3000/api-json) · [Postman collection](postman/cocos-challenge.postman_collection.json) · [REST Client requests](requests.http)

## Getting started

**Requirements:** Node.js 22 and Docker with Compose v2.

```sh
cp .env.example .env
npm ci
npm run db:up
npm run start:dev
```

The API runs at `http://localhost:3000` by default. To try it:

```sh
curl http://localhost:3000/health
curl 'http://localhost:3000/instruments/search?q=NRTE'
curl http://localhost:3000/users/1/portfolio
```

PostgreSQL runs in Docker. The initialization scripts under `db/init/` create two databases on the first start:

| Database | Contents | Purpose |
| --- | --- | --- |
| `cocos` | Original schema with synthetic demo data | Local API |
| `cocos_test` | Original schema without demo data | Isolated automated tests |

`npm run db:down` stops PostgreSQL without deleting its data. **To reset the databases**, run `docker compose down -v && npm run db:up` (this deletes the local database volume).

### Running with Docker

The multi-stage Docker image runs the compiled application as a non-root user. To start the API and PostgreSQL together:

```sh
cp .env.example .env # if not already configured
APP_PORT=3000 docker compose --profile app up --build -d --wait
curl http://localhost:3000/health
```

Stop the application with `docker compose --profile app down app`. The PostgreSQL volume is retained.

The image can also run independently against a PostgreSQL server accessible from its network:

```sh
docker build -t cocos-challenge .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME \
  cocos-challenge
```

In Docker Compose, the database hostname is `postgres`, not `localhost`. Use protected environment configuration for real credentials; do not commit connection strings or secrets.

### Configuration

Copy `.env.example` and adjust the variables as needed. Configuration is validated at startup.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection URL |
| `PORT` | `3000` | HTTP port |
| `DB_LOCK_TIMEOUT_MS` | `5000` | Maximum wait for the per-user row lock |
| `DB_POOL_MAX` | `10` | Maximum database connections in the pool |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | `5000` | Maximum wait to acquire a database connection |
| `TEST_DATABASE_URL` | Required for E2E | Must target local `cocos_test` |

Pool and lock timeouts bound contention and return HTTP 503 when the database cannot serve a request. A waiting order holds a connection, so pool size should be chosen with the database connection limit in mind.

## API

The complete request and response schemas, validation rules, and error codes are available in [Swagger UI](http://localhost:3000/api). Monetary values and percentages are returned as decimal strings; all prices are in ARS.

### Instrument search

`GET /instruments/search?q=NRTE`

```json
[
  { "id": 2, "ticker": "NRTE", "name": "Norte Energía S.A.", "type": "ACCIONES" }
]
```

Search is case-insensitive and matches ticker or name. Exact ticker matches rank before prefixes and other matches; `MONEDA` instruments are excluded. `limit` defaults to 20 and accepts 1–50. No matches return `200 []`.

### Portfolio

`GET /users/1/portfolio` — complete example using the fresh **synthetic demo dataset**:

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
      "instrumentId": 5,
      "ticker": "LUMI",
      "name": "Lumina Telecom S.A.",
      "quantity": 50,
      "lastPrice": "1775.50",
      "marketValue": "88775.00",
      "averageCost": "1790.00",
      "totalReturnPercent": "-0.81",
      "dailyPriceChangePercent": "-1.36"
    },
    {
      "instrumentId": 6,
      "ticker": "MARB",
      "name": "Banco del Mar S.A.",
      "quantity": 20,
      "lastPrice": "3250.75",
      "marketValue": "65015.00",
      "averageCost": "3150.00",
      "totalReturnPercent": "3.20",
      "dailyPriceChangePercent": "1.59"
    },
    {
      "instrumentId": 2,
      "ticker": "NRTE",
      "name": "Norte Energía S.A.",
      "quantity": 90,
      "lastPrice": "1050.00",
      "marketValue": "94500.00",
      "averageCost": "1003.33",
      "totalReturnPercent": "4.65",
      "dailyPriceChangePercent": "2.94"
    }
  ]
}
```

The total includes cash and all three positions: `1609400.00 + 88775.00 + 65015.00 + 94500.00 = 1857690.00`. Results change after placing orders. Unknown users return `404 USER_NOT_FOUND`.

### Place an order

`POST /orders` **writes to the database**. Example LIMIT BUY by investment amount:

```json
{
  "userId": 1,
  "instrumentId": 2,
  "side": "BUY",
  "type": "LIMIT",
  "amount": "10000.00",
  "price": "1000.00"
}
```

Example response (`id` and `datetime` vary):

```json
{
  "id": 15,
  "userId": 1,
  "instrumentId": 2,
  "side": "BUY",
  "type": "LIMIT",
  "status": "NEW",
  "size": 10,
  "price": "1000.00",
  "datetime": "2026-11-08T15:04:05.123Z",
  "rejectionReason": null
}
```

Provide exactly one of `size` (whole shares) or `amount` (ARS, converted using `floor(amount / price)`). For MARKET orders, omit `price`: the latest market `close` is used and the order is `FILLED`. LIMIT orders require `price` and remain `NEW`. Money inputs are positive decimal strings with at most two fractional digits; invalid precision is rejected, never rounded.

| HTTP | Outcome |
| --- | --- |
| `201` | Order persisted as `FILLED`, `NEW`, or `REJECTED` |
| `400` | Invalid request (`VALIDATION_ERROR`) |
| `404` | User or instrument not found |
| `422` | Instrument unavailable/not tradable, zero quantity, or quantity out of range |
| `503` | Database unavailable (`SERVICE_UNAVAILABLE`) |

Insufficient cash or shares produces a **persisted `REJECTED` order with HTTP 201** and a `rejectionReason` of `INSUFFICIENT_FUNDS` or `INSUFFICIENT_SHARES`. Validation failures do not write an order.

### Health and API collections

`GET /health` returns `200 {"status":"ok"}` when PostgreSQL responds within the readiness timeout, or HTTP 503 otherwise. It checks **readiness**, not process liveness.

- **Postman:** import [`postman/cocos-challenge.postman_collection.json`](postman/cocos-challenge.postman_collection.json); update its `baseUrl` variable if needed. Requests include assertions and identify database writes.
- **REST Client:** open [`requests.http`](requests.http) in VS Code with the REST Client extension and select *Send Request*.

Examples use the synthetic demo dataset. Run write examples against a disposable database if you want to preserve your local data.

## Design and business rules

### Architecture

The application is organized by feature, with the financial domain isolated from infrastructure:

```text
src/
  instruments/       Search API and repository
  market-data/       Latest-price repository
  trading/
    domain/          Financial ledger, order sizing/decision, valuation
    orders/          Controller, DTO, service, persistence port
    portfolio/       Controller, service, persistence port
    persistence/     TypeORM adapters, transactions, entities
  health/            Database readiness
  common/            Decimal helpers and error handling
  config/            Environment validation and database options
```

Domain rules use Decimal.js, not floating-point arithmetic. Application services depend on application-owned ports; TypeORM, SQL, and transaction handling stay inside persistence adapters. ESLint enforces these dependency boundaries. The supplied PostgreSQL schema remains unchanged (`synchronize` and `migrationsRun` are disabled).

### Financial calculations

- **Cash balance:** FILLED `CASH_IN − CASH_OUT − BUY + SELL`, where BUY/SELL use `size × price`. For cash transfers, `size` represents the ARS amount.
- **Available balance:** cash balance minus reservations from `NEW` BUY orders. Available shares exclude quantities reserved by `NEW` SELL orders. **Reservations are an explicit design assumption.**
- **Positions:** net shares from FILLED BUY/SELL orders. `NEW`, `REJECTED`, and `CANCELLED` do not change holdings; closed positions are omitted.
- **Cost basis:** weighted-average purchase cost. FILLED orders are processed by `datetime`, then `id`; selling reduces cost proportionally without changing the average unit cost.
- **Valuation:** latest `marketdata.close` (most recent `date`, highest `id` on ties). Total account value is cash balance plus position market values. Missing prices yield `null` for price-derived values and the account total; `valuationComplete` becomes `false`.
- **Returns:** `totalReturnPercent` is unrealized return on the current holding; `dailyPriceChangePercent` is the instrument's price change against `previousClose`, not the investor's return.
- **Historical negative positions:** the original challenge data includes an oversold BMA position. It remains visible with negative quantity and market value but has no supported average cost or total return. New SELL orders cannot create or deepen a short position.

### Consistency and reliability

- **Orders:** a `READ COMMITTED` transaction locks the user's row with `SELECT … FOR UPDATE`, then checks balances and persists the result. This serializes orders for the same user across application instances and prevents concurrent overspending.
- **Portfolio:** read-only `REPEATABLE READ` transactions provide a consistent snapshot without locking the user's trading activity.
- **UTC:** order timestamps use `clock_timestamp() AT TIME ZONE 'UTC'` after the user lock is acquired and are returned as ISO 8601 UTC strings.
- **Availability:** bounded pool acquisition and lock waits, plus database error classification, result in `503 SERVICE_UNAVAILABLE` without leaking infrastructure details.
- **Uncertain commits:** a connection failure during COMMIT may leave the result unknown. Without idempotency keys, retrying `POST /orders` after a lost response or 503 may duplicate an order.

## Verification

```sh
npm run format:check
npm run lint
npm run build
npm test
npm run test:e2e
```

The test database is restricted to local `cocos_test`, protecting demo data. The project currently has **249 unit tests** and **199 E2E tests**, covering financial rules, validation, order concurrency, transaction rollback, portfolio consistency, database failures, readiness, and OpenAPI schemas. GitHub Actions runs these checks with PostgreSQL 16 and separately builds and inspects the production Docker image.

Compatibility with the **original Cocos `database.sql`** was verified using a disposable local PostgreSQL instance. The schema matched, and user 1 produced cash `753000.00`, available cash `627500.00`, and total account value `889756.00` (PAMP 40, BMA −10, METR 500). Order flows were also tested on that local copy. **The hosted Neon database was not accessed or tested.**

### Security and scope limitations

- Authentication and authorization are not included, as permitted by the challenge. Callers can specify any `userId`.
- There is no market simulation, LIMIT-order matching, cancellation endpoint, or idempotency mechanism.
- The ledger is computed from order history on each request, and the unchanged schema has no index on `orders.userid`; this is suitable for challenge-scale data, not an optimized high-volume brokerage workload.
- Search uses case-insensitive substring matching, not fuzzy or accent-insensitive search.
- `npm audit --omit=dev` reported five transitive advisories at the time of review, involving `multer` and TypeORM's `glob`/`minimatch` dependency tree. The relevant upload and dynamic file-discovery functionality is not used by this API, reducing the assessed exposure. Major-version dependency changes were intentionally deferred; the advisories remain documented residual risks.
- Logging is basic; production monitoring, metrics, tracing, and operational hardening are outside the challenge scope.
