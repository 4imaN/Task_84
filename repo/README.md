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

For local-network access on another machine, open `http://<host-or-lan-ip>:4000` from that client.  
Same-host LAN browser origins are accepted automatically by both bootstrap CORS and CSRF origin checks, and extra cross-origin browser origins can be allowlisted through `APP_ALLOWED_ORIGINS`.

### Local Development Startup

LedgerRead also supports a local development flow without the full Docker app wrapper.
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

## Seeded Accounts

The startup path runs migrations and then invokes the seed script. Seeding is non-destructive by default (it skips initialized databases), so normal restarts preserve immutable governance history.
Passwords are never echoed by the test runner.

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
The API e2e coverage is split by domain under `apps/api/test/` (`app.e2e.spec.ts`, `app.community-pos.e2e.spec.ts`, `app.governance.e2e.spec.ts`) to keep ownership boundaries and regressions easier to trace.

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
- Browser-facing auth is cookie-only: API guards do not accept `Authorization: Bearer ...` as a fallback for session routes.
- Cookie-authenticated unsafe requests require a per-session `X-CSRF-Token`, and the API rejects cross-origin mutation attempts even when a browser session cookie is present.
- `POST /auth/login` is origin-validated as well: login rejects missing/disallowed origins and only accepts requests from configured or same-host allowed origins.
- Password policy is centrally enforced by shared validation logic:
  - minimum 10 characters
  - at least one number
  - at least one symbol
  - login attempts that violate policy are rejected and still count toward lockout accounting
  - seed/bootstrap account provisioning rejects non-compliant passwords before user rows are created
- Origin/CORS policy is explicit and configurable:
  - `APP_ALLOWED_ORIGINS` adds comma-separated allowed browser origins (for example LAN hostname/IP development hosts)
  - bootstrap CORS and cookie-authenticated mutation guards allow same-host origins derived from request host data
  - `x-forwarded-host` is ignored unless `APP_TRUSTED_PROXY_HOPS > 0`, so spoofed forwarded headers cannot widen origin trust by default
- The frontend API helpers now use cookie-only transport as well:
  - requests send `credentials: include`
  - unsafe requests send the session `X-CSRF-Token`
  - the browser client does not attach bearer tokens
  - client-side request telemetry records the server `x-trace-id` for troubleshooting
- `audit_logs` and `attendance_records` are append-only at the database layer through update/delete rejection triggers, and `GET /admin/audit-integrity` re-verifies both hash chains plus keyed chain signatures so tampering cannot be masked by hash recomputation from row data alone.
- Runtime DB access is least-privileged:
  - delivery runtime uses `ledgerread_app` (`DATABASE_URL`) while migrations/seeding use `DATABASE_ADMIN_URL`
  - migrations revoke blanket table grants and re-grant only required per-table operations to `ledgerread_app`
  - runtime `users` updates are narrowed to lockout/suspension lifecycle columns (`failed_login_attempts`, `locked_until`, `updated_at`, `is_suspended`) instead of table-wide updates
  - runtime cannot modify migration/seed metadata tables (`schema_migrations`, `seed_metadata`) and cannot create schema objects
  - append-only governance tables (`audit_logs`, `attendance_records`) remain `SELECT`/`INSERT` only for runtime
  - runtime startup rejects `DATABASE_URL` values that run the API as the `postgres` superuser by default in every environment
  - local superuser runtime is only allowed with explicit `LEDGERREAD_ALLOW_SUPERUSER_RUNTIME=1` in non-production environments
- Customer catalog and community views include digital, physical, and bundle SKUs. Reader entry still stays format-gated: `/app/reader/:id` rejects unreadable products and only opens readable digital titles with chapter payloads.
- Customer reading profiles and cached titles live in IndexedDB as AES-GCM blobs sealed with a per-user non-extractable browser key. Legacy clear-text profile blobs are migrated once and then removed from `localStorage`.
  - reader font-size preferences are treated as points (`pt`) end to end (profile payloads, portability view, and rendered chapter typography)
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
  - manifest imports stay restricted to `MANAGER` and `INVENTORY_MANAGER`
  - payment plan status transitions are restricted to `MANAGER` and `FINANCE`
  - discrepancy status transitions are restricted to `MANAGER` and `INVENTORY_MANAGER`
- Attendance chronology now uses server-authoritative event time for compliance/risk decisions and tamper-chain verification. Client-submitted `occurredAt` is accepted only within `ATTENDANCE_CLIENT_CLOCK_SKEW_SECONDS` and stored as `client_occurred_at` metadata.
- Attendance least-privilege scope is role-partitioned:
  - only `CLERK` can call `/attendance/clock-in` and `/attendance/clock-out`
  - `/attendance/risks` allows clerk self-view plus `MANAGER`/`FINANCE`/`INVENTORY_MANAGER` global oversight
  - global risk viewers trigger immediate overdue evaluation across all users at read time (not only on cron), so compliance views are fresh
- Attendance evidence uploads are capped at `5 MiB` by default through `ATTENDANCE_EVIDENCE_MAX_BYTES`, and oversized files return a controlled `413 Payload Too Large` instead of a generic upload failure.
- Attendance evidence uploads now require a checksum whenever a file is attached. The browser computes a local SHA-256 for comparison, and the API rejects missing or mismatched checksums instead of accepting unchecked evidence.
- `/admin/audit-logs` applies payload minimization/redaction server-side and returns a `redacted_fields` count; sensitive hash/token/body-like keys are no longer exposed as raw API response fields.
- Recommendation snapshots fall back to best sellers not only on timeout, but also when snapshot rows are missing or empty, and the recommendation trace log records which fallback path was used.
- Docker-backed runtime and test flows share the generated key file at `.ledgerread-runtime/app_encryption_key`, which keeps encrypted rows readable across repeated local runs.
