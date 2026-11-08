# Cocos Challenge — Brokerage API

REST API (NestJS + TypeORM + PostgreSQL) for a brokerage account: portfolio, instrument search and order placement.

> Work in progress: the project scaffold and local database are in place; the API endpoints are added incrementally.

## Prerequisites

- Node.js 22+ (see `.nvmrc`)
- Docker with Compose v2

## Local setup

```sh
cp .env.example .env     # throwaway local credentials; .env is git-ignored
npm install
npm run db:up            # starts PostgreSQL 16 and waits until it is healthy
npm run start:dev        # http://localhost:3000 (change PORT in .env if it is taken)
```

`npm run db:down` stops the database and keeps its data. To wipe it and re-run the init scripts from scratch:

```sh
docker compose down -v && npm run db:up
```

## Databases

One PostgreSQL container hosts two databases, created by the scripts in `db/init/` the first time the volume is initialized:

| Database     | Contents                                          | Used by                               |
| ------------ | ------------------------------------------------- | ------------------------------------- |
| `cocos`      | Schema + synthetic demo data (`02-demo-seed.sql`) | the application (`DATABASE_URL`)      |
| `cocos_test` | Schema only; fixtures are loaded by the tests     | automated tests (`TEST_DATABASE_URL`) |

- The schema (`db/init/01-schema.sql`) matches the one provided with the challenge; nothing was added. TypeORM never changes it: `synchronize` and `migrationsRun` are disabled.
- Tests refuse to run unless `TEST_DATABASE_URL` points to a `cocos_test` database on localhost, so they cannot modify the demo data.

## Scripts

| Command                     | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `npm run build`             | Compile to `dist/`                                    |
| `npm run start`             | Run the app (`start:dev` for watch mode)              |
| `npm run lint`              | ESLint (`format` / `format:check` for Prettier)       |
| `npm test`                  | Unit tests (no database needed)                       |
| `npm run test:e2e`          | Functional tests against `cocos_test` (needs `db:up`) |
| `npm run db:up` / `db:down` | Start / stop the local PostgreSQL                     |

## Verify the setup

```sh
npm run db:up && npm run build && npm run lint && npm test && npm run test:e2e
```

## Configuration

Environment variables are validated at startup (the app refuses to start on invalid values). See `.env.example`.

| Variable             | Default | Description                                        |
| -------------------- | ------- | -------------------------------------------------- |
| `DATABASE_URL`       | —       | PostgreSQL connection URL (required)               |
| `PORT`               | `3000`  | HTTP port                                          |
| `DB_LOCK_TIMEOUT_MS` | `5000`  | Max wait for the per-user lock when placing orders |
| `TEST_DATABASE_URL`  | —       | Tests only; must target `cocos_test`               |
