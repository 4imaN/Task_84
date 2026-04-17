# Delivery Acceptance & Project Architecture Audit (Static-Only)

Date: 2026-04-05
Reviewer Mode: Static analysis only (no runtime execution)

## 1. Verdict
- Overall conclusion: **Partial Pass**

## 2. Scope and Static Verification Boundary
- Reviewed:
  - Project documentation, startup/test/config instructions, and manifests.
  - Backend entry points, module registration, auth/session/CSRF/role guards, core services, migrations, and seed scripts.
  - Frontend route structure, role gating, reader/community/POS/admin workflows, and local storage/encryption helpers.
  - Unit/integration/e2e test code and logging-related code/tests.
- Not reviewed:
  - Any live runtime behavior in browser, container, or networked environment.
  - Any third-party infrastructure behavior beyond static code assumptions.
- Intentionally not executed:
  - Project startup, Docker, test suites, external services.
- Claims requiring manual verification:
  - LAN access behavior from a second machine.
  - Actual UI rendering quality and responsiveness in browser.
  - Real runtime performance claims (for example “high-performance reader”).

## 3. Repository / Requirement Mapping Summary
- Prompt core goal mapped: offline-first reader + moderated community + staff checkout/governance system with auditable controls.
- Main implementation areas mapped:
  - Auth/session/CSRF/roles: `apps/api/src/auth/*`
  - Reader/profile portability/sync: `apps/api/src/profiles/*`, `apps/web/src/pages/customer/ReaderPage.tsx`, `apps/web/src/pages/customer/ProfilePortabilityPage.tsx`
  - Community/governance/moderation: `apps/api/src/community/*`, `apps/api/src/moderation/*`, `apps/api/src/catalog/catalog.service.ts`
  - POS/reconciliation/costing: `apps/api/src/pos/*`, `apps/api/src/admin/*`, `apps/web/src/pages/pos/PosPage.tsx`, `apps/web/src/pages/admin/FinancePage.tsx`
  - Attendance/risk/hash chains: `apps/api/src/attendance/*`, `apps/api/src/audit/*`
  - Recommendations/cache/fallback/trace: `apps/api/src/recommendations/*`
  - DB model/security constraints: `packages/db/src/migrations/*`

## 4. Section-by-section Review

### 1.1 Documentation and static verifiability
- Conclusion: **Partial Pass**
- Rationale: Startup/test/config docs are substantial and mostly consistent with scripts and structure, but documented LAN access behavior conflicts with CORS runtime defaults.
- Evidence:
  - `README.md:5-66`, `README.md:91-147`, `README.md:149-202`
  - `package.json:9-22`
  - `apps/api/package.json:5-13`
  - `apps/web/package.json:5-10`
  - LAN claim: `README.md:22-24`, `README.md:163-166`
  - CORS implementation: `apps/api/src/main.ts:13-23`
  - Default origin config: `apps/api/src/config/app-config.ts:68-74`
  - Docker defaults: `docker-compose.yml:32-33`
- Manual verification note: Verify login + authenticated mutation from `http://<host-or-lan-ip>:4000` on a second machine.

### 1.2 Material deviation from Prompt
- Conclusion: **Partial Pass**
- Rationale: Most prompt requirements are implemented, but the required LAN/localhost consumption path is at risk by default due origin policy mismatch.
- Evidence:
  - Prompt-local-network intent reflected in docs: `README.md:22-24`, `README.md:163-166`
  - Runtime origin gating: `apps/api/src/main.ts:13-23`, `apps/api/src/config/app-config.ts:68-74`, `docker-compose.yml:32-33`
- Manual verification note: Confirm full customer login/read/comment and clerk checkout flows from LAN origin.

### 2.1 Core requirement coverage
- Conclusion: **Partial Pass**
- Rationale: Core reader/community/POS/governance/reconciliation/attendance/recommendation requirements are statically present with corresponding DB and API logic; LAN access expectation remains the main gap.
- Evidence:
  - Reader/prefs/sync: `apps/api/src/profiles/dto/reading-preferences.dto.ts:15-47`, `apps/api/src/profiles/profiles.service.ts:71-132`, `apps/web/src/components/reader/ReaderPreferencesPanel.tsx:21-99`, `apps/web/src/pages/customer/ProfilePortabilityPage.tsx:42-190`
  - Community/governance: `apps/api/src/community/community.service.ts:60-164`, `apps/api/src/community/community.service.ts:166-253`, `apps/api/src/moderation/moderation.service.ts:187-285`, `apps/api/src/catalog/catalog.service.ts:299-309`
  - POS tamper controls: `apps/api/src/pos/pos.service.ts:464-567`
  - Reconciliation/costing/discrepancies: `apps/api/src/admin/admin.service.ts:80-114`, `apps/api/src/admin/admin.service.ts:213-243`
  - Attendance and hash chain: `apps/api/src/attendance/attendance.service.ts:23-41`, `apps/api/src/attendance/attendance.service.ts:87-141`, `apps/api/src/attendance/attendance.service.ts:209-239`, `apps/api/src/attendance/attendance.service.ts:321-380`
  - Recommendations: `apps/api/src/recommendations/recommendations.service.ts:47-93`, `apps/api/src/recommendations/recommendations.service.ts:178-220`

### 2.2 End-to-end deliverable (0 to 1)
- Conclusion: **Pass**
- Rationale: Full monorepo structure, migrations, seed data, API/web apps, and test suites are present; this is not a snippet/demo-only delivery.
- Evidence:
  - Workspace structure: `README.md:149-156`
  - DB migrations: `packages/db/src/migrations/001_initial_schema.ts:9-304`, `packages/db/src/migrations/index.ts:1-20`
  - Seed script: `apps/api/src/scripts/seed.ts:328-507`
  - Full route trees: `apps/web/src/App.tsx:27-127`
- Manual verification note: Runtime end-to-end behavior was not executed in this audit.

### 3.1 Engineering structure and module decomposition
- Conclusion: **Pass**
- Rationale: Clear module boundaries by domain (auth, profiles, community, moderation, POS, admin, attendance, recommendations), with corresponding controllers/services and DB migrations.
- Evidence:
  - Module registration: `apps/api/src/app.module.ts:34-87`
  - Domain controllers/services: `apps/api/src/*/*.controller.ts`, `apps/api/src/*/*.service.ts`
  - Frontend workspace segmentation: `apps/web/src/App.tsx:48-125`

### 3.2 Maintainability and extensibility
- Conclusion: **Pass**
- Rationale: Validation DTOs, transactional service boundaries, migration versioning, explicit role guards, and test coverage indicate maintainable structure rather than hardcoded one-off implementation.
- Evidence:
  - DTO validation patterns: `apps/api/src/profiles/dto/reading-preferences.dto.ts:14-63`, `apps/api/src/community/dto/community.dto.ts:15-86`, `apps/api/src/pos/dto/pos.dto.ts:12-47`
  - Transaction usage: `apps/api/src/pos/pos.service.ts:350-635`, `apps/api/src/admin/admin.service.ts:124-599`
  - Migration versioning: `packages/db/src/migrations/index.ts:1-20`

### 4.1 Engineering details and professionalism (error handling, logging, validation, API design)
- Conclusion: **Partial Pass**
- Rationale: Strong validation, structured logging, and security controls are present, but a production bootstrap policy mismatch (CORS vs documented LAN behavior) is material.
- Evidence:
  - Validation + controlled errors: `apps/api/src/main.ts:31-37`, `apps/api/src/common/file-upload-exception.filter.ts:21-45`
  - Auth/session/lockout: `apps/api/src/auth/auth.service.ts:81-95`, `apps/api/src/auth/auth.service.ts:166-174`, `apps/api/src/auth/auth.service.ts:286-300`
  - Logging patterns: `apps/api/src/auth/auth.service.ts:142-152`, `apps/api/src/moderation/moderation.service.ts:32-41`, `apps/api/src/attendance/attendance.service.ts:60-70`
  - Material mismatch: `README.md:22-24`, `apps/api/src/main.ts:13-23`, `docker-compose.yml:32-33`

### 4.2 Product/service realism vs demo shape
- Conclusion: **Pass**
- Rationale: The system includes role-separated workspaces, reconciliation, attendance governance, immutable audit mechanics, and non-trivial test scaffolding consistent with product-oriented delivery.
- Evidence:
  - Workspaces and guards: `apps/web/src/App.tsx:48-125`, `apps/api/src/*/*.controller.ts`
  - Governance and integrity APIs: `apps/api/src/admin/admin.controller.ts:68-76`, `apps/api/src/audit/audit.service.ts:77-145`

### 5.1 Prompt understanding and requirement fit
- Conclusion: **Partial Pass**
- Rationale: Business intent is well understood and broadly implemented; LAN accessibility expectation is the only major fit risk.
- Evidence:
  - Reader/community/POS/reconciliation/attendance/recommendation mapping in Sections 2.1 and 4.2.
  - LAN mismatch evidence in Sections 1.1 and 1.2.

### 6.1 Aesthetics (frontend)
- Conclusion: **Cannot Confirm Statistically**
- Rationale: Static code indicates a coherent design system and interaction states, but visual quality and interaction smoothness require browser rendering.
- Evidence:
  - UI structure: `apps/web/src/App.tsx:27-127`
  - Shared styles and interaction classes: `apps/web/src/index.css:31-129`
  - Reader/community/POS/admin pages: `apps/web/src/pages/customer/ReaderPage.tsx:73-111`, `apps/web/src/pages/customer/CommunityPage.tsx:1-42`, `apps/web/src/pages/pos/PosPage.tsx:1-120`, `apps/web/src/pages/admin/FinancePage.tsx:1-120`
- Manual verification note: Validate desktop/mobile render, state transitions, and layout consistency in browser.

## 5. Issues / Suggestions (Severity-Rated)

### [High] LAN same-host browser access is documented as supported, but CORS defaults likely block it
- Conclusion: **Fail (material runtime-risk mismatch)**
- Evidence:
  - LAN support claim: `README.md:22-24`, `README.md:163-166`
  - CORS callback only checks explicit set membership: `apps/api/src/main.ts:13-23`
  - Default allowlist source: `apps/api/src/config/app-config.ts:68-74`
  - Docker defaults are localhost-only origins: `docker-compose.yml:32-33`
  - Same-host fallback exists only in mutation-origin helper used by CSRF guard: `apps/api/src/common/allowed-origins.ts:51-80`, `apps/api/src/auth/csrf.guard.ts:47-49`, `apps/api/src/auth/csrf.guard.ts:63-65`
- Impact:
  - Opening `http://<host-or-lan-ip>:4000` from another machine can fail login/mutation flows despite documentation and prompt expectations.
- Minimum actionable fix:
  - Align CORS origin decision with same-host LAN logic (or expand default allowlist generation for same-host LAN origins), and update docs to match exact required env values if configuration is mandatory.
- Minimal verification path:
  - From a second LAN machine, attempt `/auth/login` and one authenticated mutation (`/attendance/clock-in` or `/community/comments`) against the unified app URL.

### [Medium] Integration tests bypass production bootstrap path, so CORS/bootstrap regressions can ship undetected
- Conclusion: **Partial Fail (coverage gap in critical edge)**
- Evidence:
  - e2e app construction bypasses `main.ts`: `apps/api/test/app.e2e.spec.ts:266-271`
  - Runtime CORS/static route config lives in `main.ts`: `apps/api/src/main.ts:11-84`
  - Current tests validate CSRF origin behavior but not bootstrap CORS wiring: `apps/api/test/app.e2e.spec.ts:437-483`
- Impact:
  - CI can pass while deployed origin behavior fails for valid LAN usage.
- Minimum actionable fix:
  - Add at least one bootstrap-level test path that starts the server with `main.ts` CORS policy and validates origin matrix (`localhost`, configured LAN origin, same-host LAN origin).
- Minimal verification path:
  - Add automated smoke asserting expected status codes for login/mutation requests under each origin case.

## 6. Security Review Summary

- Authentication entry points: **Pass**
  - Evidence: `apps/api/src/auth/auth.controller.ts:32-77`, `apps/api/src/auth/dto/login.dto.ts:8-11`, `apps/api/src/auth/auth.service.ts:154-238`, `apps/api/src/auth/auth.service.ts:246-323`.

- Route-level authorization: **Pass**
  - Evidence: role-guarded controllers/resolvers (`apps/api/src/profiles/profiles.controller.ts:11-13`, `apps/api/src/community/community.controller.ts:18-20`, `apps/api/src/pos/pos.controller.ts:17-19`, `apps/api/src/moderation/moderation.controller.ts:11-13`, `apps/api/src/admin/admin.controller.ts:26-33`, `apps/api/src/catalog/catalog.resolver.ts:13-19`).

- Object-level authorization: **Pass**
  - Evidence: cart ownership enforcement (`apps/api/src/pos/pos.service.ts:125-173`), profile self-scope (`apps/api/src/profiles/profiles.controller.ts:16-37`), clerk-scoped risk alerts (`apps/api/src/attendance/attendance.service.ts:285-311`), cart isolation e2e coverage (`apps/api/test/app.e2e.spec.ts:2443`).

- Function-level authorization: **Pass**
  - Evidence: method-level role narrowing for sensitive mutations (`apps/api/src/admin/admin.controller.ts:31-33`, `apps/api/src/admin/admin.controller.ts:46-48`, `apps/api/src/admin/admin.controller.ts:57-59`), moderation suspend restrictions (`apps/api/src/moderation/moderation.service.ts:211-217`).

- Tenant / user data isolation: **Partial Pass**
  - Evidence: robust user-level isolation in key flows (`apps/api/src/pos/pos.service.ts:125-173`, `apps/api/src/profiles/profiles.service.ts:16-57`, `apps/api/src/attendance/attendance.service.ts:307-311`).
  - Note: multi-tenant isolation is not modeled in this codebase; this appears outside scope rather than an explicit defect.

- Admin / internal / debug endpoint protection: **Pass**
  - Evidence: admin endpoints guarded (`apps/api/src/admin/admin.controller.ts:25-77`), GraphQL playground/introspection limited to development (`apps/api/src/app.module.ts:54-55`).

## 7. Tests and Logging Review

- Unit tests: **Pass**
  - Evidence: domain unit suites exist across auth/community/catalog/moderation/attendance/recommendations/POS/admin (`apps/api/src/**/*.spec.ts`, `apps/web/src/**/*.test.tsx`).

- API / integration tests: **Partial Pass**
  - Evidence: broad e2e coverage for auth/authorization/community/POS/attendance/reconciliation/integrity (`apps/api/test/app.e2e.spec.ts:402-3270`), but bootstrap path gap remains (`apps/api/test/app.e2e.spec.ts:266-271` vs `apps/api/src/main.ts:11-84`).

- Logging categories / observability: **Pass**
  - Evidence: structured category logging for auth/moderation/attendance and trace IDs in request context (`apps/api/src/auth/auth.service.ts:142-152`, `apps/api/src/moderation/moderation.service.ts:32-41`, `apps/api/src/attendance/attendance.service.ts:60-70`, `apps/api/src/common/request-context.middleware.ts:8-11`).

- Sensitive-data leakage risk in logs / responses: **Partial Pass**
  - Evidence: explicit redaction tests for auth/moderation logs (`apps/api/src/auth/auth.service.spec.ts:196-239`, `apps/api/src/moderation/moderation.service.spec.ts:121-168`), client telemetry message sanitization (`apps/web/src/lib/telemetry.ts:27-73`).
  - Residual boundary: no runtime log sink inspection performed.

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview
- Unit tests exist:
  - Backend Jest unit specs: `apps/api/src/**/*.spec.ts`.
  - Frontend Vitest specs: `apps/web/src/**/*.test.tsx`, `apps/web/src/**/*.test.ts`.
- API/integration tests exist:
  - `apps/api/test/app.e2e.spec.ts`, `apps/api/test/startup-governance.spec.ts`.
- Frameworks and entry points:
  - Backend: Jest/Supertest (`apps/api/package.json:12`)
  - Frontend: Vitest (`apps/web/package.json:9`)
  - Workspace scripts: `package.json:10`, `package.json:17-21`
- Test commands documented:
  - `README.md:91-116`, `README.md:128-147`.

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) (`file:line`) | Key Assertion / Fixture / Mock (`file:line`) | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Auth baseline: 401, lockout, idle expiry | `apps/api/test/app.e2e.spec.ts:402`, `apps/api/test/app.e2e.spec.ts:566`; `apps/api/src/auth/auth.service.spec.ts:51`, `:80`, `:139` | 401 unauth check and lockout/session-expiry expectations | sufficient | None material | N/A |
| Cookie-only auth + CSRF/origin + bearer rejection | `apps/api/test/app.e2e.spec.ts:406`, `:437`, `:492` | Missing/disallowed origin and missing/invalid CSRF are rejected; bearer-only rejected | basically covered | Does not validate bootstrap CORS path from `main.ts` | Add bootstrap-level origin matrix test using actual bootstrap config |
| Route-level authorization (401/403 by role) | `apps/api/test/app.e2e.spec.ts:529`, `:627`, `:718` | Wrong-role access receives 403; role-allowed actions succeed | sufficient | None material | N/A |
| Object-level authorization (cart/profile isolation) | `apps/api/test/app.e2e.spec.ts:1341`, `:2443` | Cross-user cart access blocked; profile/me scoped behavior | sufficient | None material | N/A |
| Community governance: masking, sensitive-word, duplicate window, rate limit | `apps/api/test/app.e2e.spec.ts:1341`, `:1668`, `:1719`, `:1767`, `:1834`; `apps/api/src/catalog/catalog.service.spec.ts:129`; `apps/api/src/community/community.service.spec.ts:130`, `:156` | Masked viewer body + anti-spam assertions | sufficient | None material | N/A |
| POS tamper prevention: review-total, stale review, stock checks, concurrency | `apps/api/test/app.e2e.spec.ts:2105`, `:2333`, `:2383`; `apps/web/src/pages/pos/PosPage.test.tsx:105`, `:165`, `:227` | Checkout blocked without/after stale review; concurrent mutations handled | sufficient | None material | N/A |
| Attendance evidence/type/checksum + risk + hash chain integrity | `apps/api/test/app.e2e.spec.ts:1297`, `:2105`, `:2473`, `:3131`; `apps/api/src/attendance/attendance.service.spec.ts:129`, `:157`, `:238`, `:276` | Signature/checksum/path checks + chain verification coverage | sufficient | None material | N/A |
| Reconciliation: moving-average, discrepancy thresholds, status transitions | `apps/api/test/app.e2e.spec.ts:718`, `:2644`; `apps/api/src/admin/admin.service.spec.ts:58`, `:63`, `:160` | Transition constraints and valuation logic checks | basically covered | Could add more malformed financial edge fixtures | Add edge tests for extreme landed-cost distributions and zero-quantity lines |
| Recommendations: timeout/empty fallback, traces, cache hit | `apps/api/test/app.e2e.spec.ts:1945`; `apps/api/src/recommendations/recommendations.service.spec.ts:66`, `:92`, `:152`, `:185` | BESTSELLER fallback + trace strategy assertions | sufficient | None material | N/A |
| DB hardening: append-only + runtime least-priv role | `apps/api/test/app.e2e.spec.ts:2510`, `:2552`; migrations `packages/db/src/migrations/004_append_only_security.ts:15-44`, `packages/db/src/migrations/009_runtime_role_least_privilege.ts:21-67` | DML forbidden on immutable tables and restricted grants validated | sufficient | None material | N/A |
| LAN same-host browser origin support in deployed bootstrap path | Helper-only test: `apps/api/src/common/allowed-origins.spec.ts:26`; e2e bootstrap bypass: `apps/api/test/app.e2e.spec.ts:266-271` | No test binds `main.ts` CORS callback (`apps/api/src/main.ts:13-23`) | missing | High-risk origin behavior gap | Add e2e/smoke that boots through `main.ts` and validates localhost + configured LAN + same-host LAN |

### 8.3 Security Coverage Audit
- Authentication: **Meaningfully covered** (401, lockout, idle timeout, bearer rejection). Severe auth regressions are likely to be caught.
  - Evidence: `apps/api/test/app.e2e.spec.ts:402`, `:492`, `:566`; `apps/api/src/auth/auth.service.spec.ts:51`, `:139`.
- Route authorization: **Meaningfully covered** (role boundaries across profiles/admin/reconciliation).
  - Evidence: `apps/api/test/app.e2e.spec.ts:529`, `:627`, `:718`.
- Object-level authorization: **Basically covered** (cart ownership and user-scoped profile/risk behavior).
  - Evidence: `apps/api/test/app.e2e.spec.ts:1341`, `:2443`.
- Tenant/data isolation: **Partially covered** (user isolation is covered; tenant model is not present).
  - Evidence: `apps/api/src/pos/pos.service.ts:125-173`, `apps/api/src/attendance/attendance.service.ts:307-311`.
- Admin/internal protection: **Basically covered**, with one blind spot.
  - Evidence: admin guards and mutation boundaries are tested (`apps/api/test/app.e2e.spec.ts:627`, `:718`), but bootstrap CORS path is not tested (`apps/api/test/app.e2e.spec.ts:266-271` vs `apps/api/src/main.ts:13-23`).

### 8.4 Final Coverage Judgment
**Partial Pass**

Major risks covered:
- Auth/session lifecycle, role authorization, object-level cart protection, anti-spam/governance, POS tamper checks, attendance integrity, reconciliation transitions, and DB immutability/least privilege.

Uncovered risk that can hide severe defects:
- Bootstrap CORS/origin behavior for LAN/same-host browser access is not exercised by the current e2e harness, so tests can pass while deployed LAN access still fails.

## 9. Final Notes
- The delivery is substantial and largely aligned to the prompt.
- The main material defect is a high-impact LAN origin-policy mismatch between documentation and runtime CORS behavior.
- All conclusions above are static-evidence-based; runtime-dependent claims are explicitly marked for manual verification.
