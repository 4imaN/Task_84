# LedgerRead Commerce & Compliance

**Project type: fullstack**

LedgerRead is an offline-first publishing retail platform built as a containerized monorepo. It combines a reader-focused customer workspace, a moderated community layer, an in-store POS flow, and a governance-heavy admin console backed by NestJS, React, and PostgreSQL.

## Startup

```bash
docker-compose up
```

This is the zero-manual-setup path. Everything—PostgreSQL, migrations, seeding, the API, and the built frontend—runs inside Docker with no host-side installs required.

`docker compose up --build` also works and forces a fresh image rebuild if the Dockerfile or source has changed since the last build.

The unified app container generates a runtime `APP_ENCRYPTION_KEY` once and persists it in `.ledgerread-runtime/app_encryption_key` when one is not supplied, so the application keeps a stable local key across restarts without relying on a checked-in demo secret.

Endpoints after startup:

- Unified app UI + REST API: [http://localhost:4000](http://localhost:4000)
- GraphQL API endpoint: [http://localhost:4000/graphql](http://localhost:4000/graphql)
  - Playground and introspection stay disabled outside development.

For local-network access on another machine, open `http://<host-or-lan-ip>:4000` from that client.
Same-host LAN browser origins are accepted automatically by both bootstrap CORS and CSRF origin checks, and extra cross-origin browser origins can be allowlisted through `APP_ALLOWED_ORIGINS`.

## How to Verify

After `docker-compose up` completes and the `ledgerread-app` container is healthy:

### Browser verification (UI)

1. Open [http://localhost:4000/login](http://localhost:4000/login)
2. Log in as Customer: username `reader.ada`, password `Reader!2026`
3. You should see the library page with catalog titles. Click a digital title to open the reader.
4. Log out, then open [http://localhost:4000/admin/login](http://localhost:4000/admin/login)
5. Log in as Manager: username `manager.li`, password `Manager!2026`
6. Navigate to Finance and Audit pages to confirm data loads.

### API verification (curl)

Health-check the session endpoint (should return 401 when unauthenticated):

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/auth/session
# Expected: 401
```

Verify the audit integrity chain:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/admin/audit-integrity
# Expected: 401 (requires authenticated session with MANAGER role)
```

### Seeded Accounts

The startup path runs migrations and then invokes the seed script. Seeding is non-destructive by default (it skips initialized databases), so normal restarts preserve immutable governance history.
Passwords are never echoed by the test runner.

| Role | Username | Password | Login URL |
|------|----------|----------|-----------|
| Customer | `reader.ada` | `Reader!2026` | `/login` |
| Customer | `reader.mei` | `Reader!2026` | `/login` |
| Clerk | `clerk.emma` | `Clerk!2026` | `/pos/login` |
| Moderator | `mod.noah` | `Moderator!2026` | `/mod/login` |
| Manager | `manager.li` | `Manager!2026` | `/admin/login` |
| Finance | `finance.zoe` | `Finance!2026` | `/finance/login` |
| Inventory | `inventory.ivan` | `Inventory!2026` | `/admin/login` |

## Running Tests

API and web unit/component test suites run entirely inside Docker containers via `run_tests.sh`. No host-side `npm install`, Node.js, or PostgreSQL is required.

```bash
./run_tests.sh        # API + web tests (Docker, default)
./run_tests.sh api    # API unit + e2e tests (Docker)
./run_tests.sh web    # Web unit/component tests (Docker)
```

The `api` mode builds the app image, starts a PostgreSQL container, and runs the NestJS suite inside a `docker compose run` container with test-scoped env vars. No host-side database or `npm install` is needed.
The `web` mode runs Vitest inside the same app container.
The default (`all`) runs both in sequence.
The wrapper reuses the shared runtime key file at `.ledgerread-runtime/app_encryption_key` automatically so backend verification does not depend on a handwritten `.env`.
The API e2e coverage is split by domain under `apps/api/test/` (`app.e2e.spec.ts`, `app.community-pos.e2e.spec.ts`, `app.governance.e2e.spec.ts`) to keep ownership boundaries and regressions easier to trace.

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
