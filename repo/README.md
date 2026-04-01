# LedgerRead Commerce & Compliance

LedgerRead is an offline-first publishing retail platform built as a containerized monorepo. It combines a reader-focused customer workspace, a moderated community layer, an in-store POS flow, and a governance-heavy admin console backed by NestJS, React, and PostgreSQL.

## Startup Options

### Official Reviewer Startup (Docker)

```bash
docker compose up --build
```

This is the zero-manual-setup path used for delivery review and the one-command requirement.
The unified app container generates a runtime `APP_ENCRYPTION_KEY` once and persists it in `.ledgerread-runtime/app_encryption_key` when one is not supplied, so the application keeps a stable local key across restarts without relying on a checked-in demo secret.

Endpoints:

- Unified app UI + REST API: [http://localhost:4000](http://localhost:4000)
- GraphQL API endpoint: [http://localhost:4000/graphql](http://localhost:4000/graphql)
  - Playground and introspection stay disabled outside development.

### Local Development Startup

LedgerRead also supports a local development flow without the full Docker app wrapper.
You can run PostgreSQL either through Docker or from an existing local install.

```bash
npm install
export APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
docker compose up -d postgres
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

- the API expects `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ledgerread`
- the Vite client proxies API traffic to `http://localhost:4000`

If you already have PostgreSQL running outside Docker, point `DATABASE_URL` at that instance instead.
Set `APP_ENCRYPTION_KEY` before running `migrate`, `seed`, or `dev:api`; local backend startup does not rely on a checked-in secret.

## Seeded Accounts

The database is auto-migrated and auto-seeded on startup, and passwords are never echoed by the test runner.

Reviewer accounts:

- Customer: `reader.ada` / `Reader!2026`
- Customer: `reader.mei` / `Reader!2026`
- Clerk: `clerk.emma` / `Clerk!2026`
- Moderator: `mod.noah` / `Moderator!2026`
- Manager: `manager.li` / `Manager!2026`
- Finance: `finance.zoe` / `Finance!2026`
- Inventory: `inventory.ivan` / `Inventory!2026`

Login entry points:

- Customer: `/login`
- Clerk: `/pos/login`
- Moderator: `/mod/login`
- Manager / Inventory: `/admin/login`
- Finance: `/finance/login`

## Backend Verification (Docker Required)

```bash
npm install
npm run test:api
```

`npm run test:api` starts the PostgreSQL test dependency through Docker Compose before resetting the test schema, migrating, seeding, and running the NestJS suite.
The wrapper also reuses the shared runtime key file automatically when `APP_ENCRYPTION_KEY` is not set, so backend verification does not depend on a handwritten `.env`.

## Frontend Verification

Standalone compile verification:

```bash
npm install
npm run build:web
npm run test:web
```

Browser-level end-to-end verification against the running Docker stack:

```bash
npx playwright install chromium
npm run test:web:e2e
```

Interactive frontend development:

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

## Workspace Layout

- `apps/web`: React + Vite frontend
- `apps/api`: NestJS API
- `packages/contracts`: shared domain types
- `packages/crypto`: browser-safe local encryption helpers
- `packages/db`: migrations and seed data

## Security Notes

- Browser auth uses an `httpOnly` session cookie. The React app rehydrates from `GET /auth/session` instead of persisting bearer tokens in `localStorage` or `sessionStorage`.
- The frontend API helpers now use cookie-only transport as well:
  - requests send `credentials: include`
  - the browser client does not attach bearer tokens
  - client-side request telemetry records the server `x-trace-id` for troubleshooting
- Customer reading profiles and cached titles live in IndexedDB as AES-GCM blobs sealed with a per-user non-extractable browser key. Legacy clear-text profile blobs are migrated once and then removed from `localStorage`.
  - browser storage keys are now obfuscated as well, so persisted `localStorage` and IndexedDB keys no longer expose clear-text usernames or title ids after migration
- Login usernames are protected at rest:
  - `users.username_cipher` stores the encrypted identifier
  - `users.username_lookup_hash` stores the deterministic keyed lookup hash used during authentication
  - persisted rows no longer keep plaintext usernames after migration/seed
- Encrypted profile import uses newest-timestamp conflict resolution end to end:
  - older imported files are ignored locally
  - newer imported files are sent through `/profiles/me/sync` so the server can keep whichever profile has the freshest timestamp
- Admin navigation is role-scoped at the page level:
  - `MANAGER`: overview, finance, inventory, audits
  - `INVENTORY_MANAGER`: overview, finance, inventory, audits
- Finance has its own workspace and route tree:
  - `FINANCE`: `/finance/settlements`, `/finance/audits`
  - `/finance/settlements` and `/admin/finance` render the same reconciliation review surface so finance and inventory staff can both review settlement status, discrepancy flags, and the linked audit trail
  - manifest imports stay restricted to `MANAGER` and `INVENTORY_MANAGER`, so the finance workspace is review-only for reconciliation intake
- Docker-backed runtime and test flows share the generated key file at `.ledgerread-runtime/app_encryption_key`, which keeps encrypted rows readable across repeated local runs.
- CI-gated verification lives in `.github/workflows/verify.yml` and runs the integrated API suite plus the Docker-backed Playwright browser suite.
