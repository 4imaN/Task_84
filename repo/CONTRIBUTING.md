# Contributing — Local Development

This file covers non-Docker local development and testing workflows intended for contributors only. The primary reviewer path is Docker-contained and documented in README.md.

## Local Development Startup

LedgerRead supports a local development flow without the full Docker app wrapper.
You can run PostgreSQL either through Docker or from an existing local install.

```bash
npm install
export APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
docker compose up -d postgres
export DATABASE_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/ledgerread
export DATABASE_URL=postgresql://ledgerread_app:ledgerread_app@localhost:5432/ledgerread
npm run build:shared
npm run migrate -w @ledgerread/api
npm run seed -w @ledgerread/api
npm run dev:api
```

In a second terminal:

```bash
npm run dev:web
```

By default:

- the API runtime expects `DATABASE_URL=postgresql://ledgerread_app:ledgerread_app@localhost:5432/ledgerread`
- migrations/seed/reset workflows use `DATABASE_ADMIN_URL` (or `DATABASE_URL` when `DATABASE_ADMIN_URL` is unset)
- the Vite client proxies API traffic to `http://localhost:4000`
- browser origin allowlisting uses `APP_BASE_URL` plus local dev defaults, with optional comma-separated extras from `APP_ALLOWED_ORIGINS`
- forwarded-host trust is disabled by default; set `APP_TRUSTED_PROXY_HOPS` (for example `1`) only when running behind a trusted reverse proxy path
- runtime startup rejects `DATABASE_URL` values that use the `postgres` superuser unless `LEDGERREAD_ALLOW_SUPERUSER_RUNTIME=1` is set explicitly in non-production local development

If you already have PostgreSQL running outside Docker, point both `DATABASE_ADMIN_URL` and `DATABASE_URL` at that instance using the appropriate admin/app-role credentials.
Set `APP_ENCRYPTION_KEY` before running `migrate`, `seed`, or `dev:api`; local backend startup does not rely on a checked-in secret.
`npm run seed -w @ledgerread/api` is restart-safe: once data exists it exits without rewriting historical governance records.
For an explicit local reset/reseed workflow, run:

```bash
npm run seed:reset -w @ledgerread/api
```

Destructive reseed is blocked when `NODE_ENV=production` unless `LEDGERREAD_ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION=1` is also set intentionally.
If baseline seed artifacts are partially present (for example an interrupted first seed), startup seeding now fails fast with a `Partial seed initialization detected` error instead of silently skipping.

## Frontend Standalone Compile Verification

```bash
npm install
npm run build:web
npm run test:web
```

## Browser-Level E2E Verification

Against the running Docker stack:

```bash
npx playwright install chromium
npm run test:web:e2e
```

## Interactive Frontend Development

```bash
docker compose up --build
npm run dev:web
```

The interactive web client proxies API traffic to `http://localhost:4000` by default.
Set `VITE_DEV_API_TARGET` if the API should resolve somewhere else on your local network.

## Optional Advanced Local Backend Verification (No Docker Wrapper)

Requires a manually running PostgreSQL instance reachable at `DATABASE_URL` or the default local Postgres URL used by the scripts.

```bash
npm install
export APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
npm run test:api:local
```

## Local Backend Smoke (Existing Postgres, No Docker Wrapper)

This smoke path is intended for environments where PostgreSQL already exists locally and you want a quick backend confidence check without the Docker app wrapper.
It resets the configured database schema before running `migrate` and `seed`, so point `DATABASE_URL` at a disposable local development database.

```bash
npm install
export APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
npm run smoke:api:local
```
