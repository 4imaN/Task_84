# Test Coverage Audit

## Project Type Detection

- README now explicitly declares `fullstack` at [README.md](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/README.md:3).
- Repo structure confirms this:
  - backend: `apps/api`
  - frontend: `apps/web`

## Backend Endpoint Inventory

Controller-defined REST endpoints resolved from Nest controllers:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`
- `GET /profiles/me`
- `PUT /profiles/me`
- `POST /profiles/me/sync`
- `POST /community/comments`
- `POST /community/reports`
- `POST /community/relationships/block`
- `POST /community/relationships/mute`
- `POST /community/ratings`
- `POST /community/favorites`
- `POST /community/subscriptions/authors`
- `POST /community/subscriptions/series`
- `GET /pos/search`
- `POST /pos/carts`
- `POST /pos/carts/:cartId/items`
- `PATCH /pos/carts/:cartId/items/:cartItemId`
- `DELETE /pos/carts/:cartId/items/:cartItemId`
- `POST /pos/carts/:cartId/review-total`
- `POST /pos/carts/:cartId/checkout`
- `POST /attendance/clock-in`
- `POST /attendance/clock-out`
- `GET /attendance/risks`
- `GET /moderation/queue`
- `POST /moderation/actions`
- `POST /admin/manifests/import`
- `GET /admin/settlements`
- `PATCH /admin/payment-plans/:paymentPlanId/status`
- `PATCH /admin/discrepancies/:discrepancyId/status`
- `GET /admin/audit-logs`
- `GET /admin/audit-integrity`

Total controller-defined REST endpoints: **31**

Route evidence:

- [apps/api/src/auth/auth.controller.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/auth/auth.controller.ts)
- [apps/api/src/profiles/profiles.controller.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/profiles/profiles.controller.ts)
- [apps/api/src/community/community.controller.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/community/community.controller.ts)
- [apps/api/src/pos/pos.controller.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/pos/pos.controller.ts)
- [apps/api/src/attendance/attendance.controller.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/attendance/attendance.controller.ts)
- [apps/api/src/moderation/moderation.controller.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/moderation/moderation.controller.ts)
- [apps/api/src/admin/admin.controller.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/admin/admin.controller.ts)

## API Test Mapping Table

Audit result:

- Every controller-defined REST endpoint has static evidence of real HTTP coverage through app bootstrap plus `supertest`.
- E2E suites bootstrap the real Nest app with `Test.createTestingModule({ imports: [AppModule] }).compile()`, call `app.init()`, and use `request(app.getHttpServer())` or `request.agent(app.getHttpServer())`.
- No `overrideProvider`, `overrideGuard`, `jest.mock`, or `vi.mock` usage was found in `apps/api/test`.

Primary HTTP test files:

- [apps/api/test/app.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.e2e.spec.ts)
- [apps/api/test/app.community-pos.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.community-pos.e2e.spec.ts)
- [apps/api/test/app.governance.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.governance.e2e.spec.ts)
- [apps/api/test/bootstrap-origin.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/bootstrap-origin.e2e.spec.ts)

Endpoint verdict:

- Covered endpoints: **31/31**
- Test type for controller-defined endpoints: **true no-mock HTTP**

Representative evidence by domain:

- auth/session/origin flows:
  - `rejects unauthenticated session access with 401`
  - `rejects cross-origin login attempts and preserves same-origin login behavior`
  - [apps/api/test/app.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.e2e.spec.ts)
- profiles/community/POS/attendance flows:
  - `runs the customer flow with profile isolation, masking, sync conflicts, and trace logging`
  - `enforces review-before-checkout and validates evidence upload boundaries`
  - [apps/api/test/app.community-pos.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.community-pos.e2e.spec.ts)
- moderation/governance/audit integrity:
  - `runs moderator and admin flows with transactional reconciliation and moving-average valuation`
  - `detects forged audit and attendance chain entries through the integrity verifier`
  - [apps/api/test/app.governance.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.governance.e2e.spec.ts)
- bootstrap CORS/origin behavior:
  - `allows localhost and configured LAN origins through the real bootstrap CORS path`
  - [apps/api/test/bootstrap-origin.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/bootstrap-origin.e2e.spec.ts)

## API Test Classification

### 1. True No-Mock HTTP

- [apps/api/test/app.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.e2e.spec.ts)
- [apps/api/test/app.community-pos.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.community-pos.e2e.spec.ts)
- [apps/api/test/app.governance.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/app.governance.e2e.spec.ts)
- [apps/api/test/bootstrap-origin.e2e.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/test/bootstrap-origin.e2e.spec.ts)

### 2. HTTP With Mocking

- None found under `apps/api/test`

### 3. Non-HTTP (unit/integration without HTTP)

Backend specs under `apps/api/src/**/*.spec.ts`, including:

- services: auth, community, profiles, audit, POS, attendance, moderation, admin, catalog, recommendations
- helper/config specs: allowed origins, password policy, cookie util, app config
- newly added security/plumbing specs:
  - [apps/api/src/auth/auth.guard.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/auth/auth.guard.spec.ts)
  - [apps/api/src/auth/csrf.guard.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/auth/csrf.guard.spec.ts)
  - [apps/api/src/auth/roles.guard.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/auth/roles.guard.spec.ts)
  - [apps/api/src/common/request-context.middleware.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/common/request-context.middleware.spec.ts)

## Mock Detection

### API e2e suites

- No qualifying route-path mocks found in `apps/api/test`

### Backend unit/spec mocking

- Standard unit-level mocking remains present in service specs, e.g. mocked DB/audit collaborators
- This does not affect the classification of controller-defined API HTTP coverage

### Frontend unit/spec mocking

- Frontend tests commonly mock `apiRequest`, `graphQLRequest`, storage, or `fetch`
- This is expected for frontend component/hook unit tests and does not count as backend API no-mock coverage

## Coverage Summary

- Total endpoints: **31**
- Endpoints with HTTP tests: **31**
- Endpoints with true no-mock HTTP tests: **31**
- HTTP coverage: **100%**
- True API coverage: **100%**

Observed extra HTTP coverage outside controller inventory:

- `OPTIONS /auth/login` via bootstrap CORS tests
- `POST /graphql` via domain e2e suites

## Unit Test Summary

### Backend Unit Tests

Evidence of backend unit/spec coverage includes:

- [apps/api/src/admin/admin.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/admin/admin.service.spec.ts)
- [apps/api/src/attendance/attendance.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/attendance/attendance.service.spec.ts)
- [apps/api/src/audit/audit.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/audit/audit.service.spec.ts)
- [apps/api/src/auth/auth.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/auth/auth.service.spec.ts)
- [apps/api/src/catalog/catalog.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/catalog/catalog.service.spec.ts)
- [apps/api/src/community/community.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/community/community.service.spec.ts)
- [apps/api/src/moderation/moderation.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/moderation/moderation.service.spec.ts)
- [apps/api/src/pos/pos.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/pos/pos.service.spec.ts)
- [apps/api/src/profiles/profiles.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/profiles/profiles.service.spec.ts)
- [apps/api/src/recommendations/recommendations.service.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/recommendations/recommendations.service.spec.ts)

Direct request-path/security additions:

- `AuthGuard`
- `CsrfGuard`
- `RolesGuard`
- `RequestContextMiddleware`

Important backend modules still not directly unit-tested:

- [apps/api/src/common/file-upload-exception.filter.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/common/file-upload-exception.filter.ts)
- [apps/api/src/security/security.service.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/security/security.service.ts)
- [apps/api/src/database/database.service.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/api/src/database/database.service.ts)
- controllers do not have direct controller-unit specs, but this is lower risk given full no-mock HTTP endpoint coverage

### Frontend Unit Tests

Frontend unit tests: **PRESENT**

Representative existing page/component tests:

- [apps/web/src/App.routes.test.tsx](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/App.routes.test.tsx)
- [apps/web/src/pages/auth/LoginPage.test.tsx](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/pages/customer/CommunityPage.test.tsx)
- [apps/web/src/pages/customer/ReaderPage.test.tsx](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/pages/customer/ReaderPage.test.tsx)
- [apps/web/src/pages/pos/AttendancePage.test.tsx](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/pages/pos/AttendancePage.test.tsx)
- [apps/web/src/pages/pos/PosPage.test.tsx](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/pages/pos/PosPage.test.tsx)
- [apps/web/src/pages/admin/FinancePage.test.tsx](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/pages/admin/FinancePage.test.tsx)

Newly added direct frontend-gap coverage:

- [apps/web/src/pages/admin/InventoryPage.test.tsx](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/pages/admin/InventoryPage.test.tsx)
- [apps/web/src/routes/RootRedirect.test.tsx](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/routes/RootRedirect.test.tsx)
- [apps/web/src/hooks/useAsyncAction.test.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/hooks/useAsyncAction.test.ts)
- [apps/web/src/hooks/useReaderWorkspace.test.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/hooks/useReaderWorkspace.test.ts)
- [apps/web/src/hooks/useFinanceWorkspace.test.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/hooks/useFinanceWorkspace.test.ts)
- [apps/web/src/hooks/usePosWorkflow.test.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/apps/web/src/hooks/usePosWorkflow.test.ts)

Frameworks/tools detected:

- Vitest
- React Testing Library
- `@testing-library/user-event`
- jsdom

Important frontend direct-test gaps still remaining:

- some lower-level component files under `apps/web/src/components/*` still rely on indirect coverage via page tests

Mandatory verdict:

- **Frontend unit tests: PRESENT**

### Cross-Layer Observation

- Testing is now materially more balanced than in the earlier audit state.
- Backend remains stronger due to complete no-mock API route coverage.
- Frontend direct coverage improved meaningfully with added hook/route/page tests.

## API Observability Check

Strengths:

- Endpoint method/path is explicit in `supertest` calls
- Request bodies/params/query are visible in tests
- Many tests assert response bodies, follow-up state, and permission behavior

Weaknesses:

- Some long scenario tests still exercise multiple endpoint contracts in one flow, which is less localized for failure diagnosis

Verdict:

- endpoint visibility: **strong**
- request visibility: **strong**
- response-contract visibility: **moderate to strong**

## Tests Check

- success paths: **strong**
- failure cases: **strong**
- edge cases: **strong**
- validation/controller-boundary behavior: **strong**
- auth/permissions: **strong**
- integration boundaries: **strong**
- browser E2E expectation for fullstack: **met**, with Playwright coverage in [tests/e2e/ledgerread.spec.ts](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/tests/e2e/ledgerread.spec.ts)

`run_tests.sh` check:

- `api`, `web`, and default `all` are Docker-backed
- `e2e` and `full` still require host-side Node/Playwright behavior
- README now accurately narrows the Docker-contained claim to API and web unit/component suites

## Test Coverage Score (0–100)

**98/100**

## Score Rationale

- Full controller-defined REST endpoint coverage through true no-mock HTTP tests
- Strong backend service/spec coverage
- Frontend unit/component/hook coverage is present and improved
- Browser E2E exists for the fullstack expectation
- Remaining deductions are limited to lower-priority direct unit-test gaps and some broad-scenario test structure

## Key Gaps

- No direct specs observed for:
  - `file-upload-exception.filter`
  - `security.service`
  - `database.service`
- Some controller-boundary behavior still depends on e2e rather than isolated unit tests
- Some endpoint assertions remain embedded in broad scenario tests

## Confidence & Assumptions

- Confidence: **high**
- Assumptions:
  - formal endpoint inventory counts only controller-defined REST endpoints
  - GraphQL and bootstrap preflight coverage are treated as extra observed HTTP coverage, not part of the formal controller inventory

# README Audit

## README Location

- README exists at [README.md](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/README.md)

## Hard Gate Failures

- **None currently identified in README**

## High Priority Issues

- None in the current reviewer-facing README

## Medium Priority Issues

- None material enough to block reviewer compliance

## Low Priority Issues

- README test instructions intentionally scope Docker-only claims to `api`, `web`, and default `all`, while contributor-only local flows live in [CONTRIBUTING.md](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/CONTRIBUTING.md)
- If desired, README could mention that browser E2E requires the separate `e2e` path and host-side Playwright tooling, but this is no longer a contradiction because the current wording does not claim Docker-only coverage for E2E

## README Verdict

**PASS**

## README Rationale

- Top-level project type declaration is present
- Required literal `docker-compose up` is present
- Access method is explicit with URL/port
- Manual verification guidance is explicit for both browser and API
- Reviewer-facing README no longer includes the previously disallowed non-Docker/manual setup workflows; those were moved to [CONTRIBUTING.md](/Users/aimanmengesha/Desktop/eagle point/Slopering/newer/Task_84/repo/CONTRIBUTING.md)
- README claims about Docker-contained testing now align with `run_tests.sh`
