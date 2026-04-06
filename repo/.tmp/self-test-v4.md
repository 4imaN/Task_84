# LedgerRead Static Delivery Acceptance & Project Architecture Audit

## 1. Verdict
- Overall conclusion: **Pass**

## 2. Scope and Static Verification Boundary
- What was reviewed:
  - Delivery docs, startup/test/config instructions, project manifests and scripts (`README.md:5`, `README.md:92`, `package.json:9`, `apps/api/package.json:5`, `apps/web/package.json:5`, `run_tests.sh:1`).
  - API bootstrap, origin/CSRF/auth/session/role guards (`apps/api/src/main.ts:16`, `apps/api/src/common/allowed-origins.ts:65`, `apps/api/src/auth/csrf.guard.ts:22`, `apps/api/src/auth/auth.service.ts:147`, `apps/api/src/auth/roles.guard.ts:19`).
  - Core domain modules: catalog/community/moderation/attendance/POS/admin/recommendations/audit/security (`apps/api/src/catalog/catalog.service.ts:70`, `apps/api/src/community/community.service.ts:60`, `apps/api/src/moderation/moderation.service.ts:190`, `apps/api/src/attendance/attendance.service.ts:333`, `apps/api/src/pos/pos.service.ts:464`, `apps/api/src/admin/admin.service.ts:167`, `apps/api/src/recommendations/recommendations.service.ts:47`, `apps/api/src/audit/audit.service.ts:32`, `apps/api/src/security/security.service.ts:36`).
  - DB schema/migrations/seed (`packages/db/src/migrations/001_initial_schema.ts:9`, `packages/db/src/migrations/004_append_only_security.ts:7`, `packages/db/src/migrations/009_runtime_role_least_privilege.ts:11`, `packages/db/src/migrations/011_chain_signatures.ts:13`, `apps/api/src/scripts/seed.ts:24`).
  - Frontend route and feature surfaces for customer/moderation/POS/admin/finance (`apps/web/src/App.tsx:27`, `apps/web/src/pages/customer/LibraryPage.tsx:10`, `apps/web/src/pages/customer/ReaderPage.tsx:64`, `apps/web/src/pages/customer/CommunityPage.tsx:7`, `apps/web/src/pages/moderation/ModeratorQueuePage.tsx:12`, `apps/web/src/pages/pos/PosPage.tsx:5`, `apps/web/src/pages/pos/AttendancePage.tsx:23`, `apps/web/src/pages/admin/FinancePage.tsx:5`).
  - Unit/integration/e2e tests statically (`apps/api/test/app.e2e.spec.ts:426`, `apps/api/test/bootstrap-origin.e2e.spec.ts:138`, `apps/api/test/app.community-pos.e2e.spec.ts:517`, `apps/api/test/app.governance.e2e.spec.ts:507`, `apps/web/src/pages/customer/LibraryPage.test.tsx:62`, `apps/web/src/pages/customer/CommunityPage.test.tsx:203`, `apps/web/src/pages/customer/ReaderPage.test.tsx:255`).
- What was not reviewed:
  - Runtime execution behavior under real browser/network/container conditions.
  - Measured latency/performance, visual polish validation, and operational deployment setup.
- What was intentionally not executed:
  - No project startup, no Docker, no tests, no external services.
- Which claims require manual verification:
  - Reverse-proxy deployment correctness when `APP_TRUSTED_PROXY_HOPS > 0` (`README.md:54`, `apps/api/src/main.ts:20`, `apps/api/src/common/allowed-origins.ts:85`).
  - Real UX/perf and responsive rendering quality for frontend experiences.

## 3. Repository / Requirement Mapping Summary
- Prompt core business goal mapped:
  - Offline-first local-network publishing retailer with customer reader/community, clerk checkout, and auditable governance/compliance.
- Core flows mapped to implementation:
  - Reader preferences + pagination/scroll + language/theme/night mode + per-user persistence + encrypted profile import/export + LAN sync conflict resolution (`apps/web/src/components/reader/ReaderPreferencesPanel.tsx:21`, `apps/web/src/components/reader/ReaderContentPanel.tsx:41`, `apps/web/src/pages/customer/ProfilePortabilityPage.tsx:42`, `apps/api/src/profiles/profiles.service.ts:110`).
  - Customer community interactions and governance controls (favorite/subscriptions/rating/comment/reply/report/mute/block + moderation queue) (`apps/api/src/community/community.controller.ts:23`, `apps/api/src/community/community.service.ts:166`, `apps/api/src/moderation/moderation.controller.ts:16`, `apps/api/src/moderation/moderation.service.ts:195`).
  - POS review-before-checkout with server-side revalidation, inventory checks, totals/fees/discounts, and cart ownership isolation (`apps/api/src/pos/pos.service.ts:464`, `apps/api/src/pos/pos.service.ts:517`, `apps/api/src/pos/pos.service.ts:125`).
  - Compliance/audit chain integrity, attendance risk/evidence/rules, reconciliation and recommendations with local refresh/cache/fallback/trace (`apps/api/src/audit/audit.service.ts:93`, `apps/api/src/attendance/attendance.service.ts:105`, `apps/api/src/admin/admin.service.ts:167`, `apps/api/src/recommendations/recommendations.service.ts:168`).

## 4. Section-by-section Review

### 1. Hard Gates

#### 1.1 Documentation and static verifiability
- Conclusion: **Pass**
- Rationale: Startup/run/test/config instructions are present and statically align with scripts/workspace layout; reviewer can attempt verification without rewriting core code.
- Evidence: `README.md:5`, `README.md:25`, `README.md:92`, `README.md:103`, `README.md:151`, `package.json:9`, `apps/api/package.json:5`, `apps/web/package.json:5`
- Manual verification note: Command success requires runtime execution outside this static audit.

#### 1.2 Material deviation from prompt
- Conclusion: **Pass**
- Rationale: Current implementation remains centered on the requested commerce/compliance scenario; prior narrowing defects are now addressed (catalog/community include physical/bundle while reader remains format-gated).
- Evidence: `apps/api/src/catalog/catalog.service.ts:70`, `apps/api/src/catalog/catalog.service.ts:149`, `apps/api/test/app.community-pos.e2e.spec.ts:517`, `apps/web/src/pages/customer/LibraryPage.tsx:63`, `apps/web/src/pages/customer/CommunityPage.test.tsx:203`

### 2. Delivery Completeness

#### 2.1 Coverage of explicit core requirements
- Conclusion: **Pass**
- Rationale: Explicit core requirements are broadly implemented across auth/offline profile portability/community governance/POS/reconciliation/attendance/recommendations.
- Evidence: `apps/api/src/auth/auth.service.ts:88`, `apps/api/src/auth/auth.service.ts:291`, `apps/api/src/community/community.service.ts:86`, `apps/api/src/attendance/attendance.service.ts:162`, `apps/api/src/admin/admin.service.ts:261`, `apps/api/src/recommendations/recommendations.service.ts:47`, `apps/web/src/pages/customer/ProfilePortabilityPage.tsx:92`, `apps/web/src/components/reader/ReaderPreferencesPanel.tsx:25`
- Manual verification note: “High-performance” runtime behavior is performance-sensitive and needs runtime benchmarking.

#### 2.2 End-to-end deliverable quality (0→1 vs demo)
- Conclusion: **Pass**
- Rationale: Full monorepo service/application structure, migrations, seed data, runtime scripts, and substantial tests/docs are present; no evidence of single-file demo-level delivery.
- Evidence: `README.md:151`, `apps/api/src/app.module.ts:34`, `apps/web/src/App.tsx:27`, `packages/db/src/migrations/001_initial_schema.ts:9`, `apps/api/test/app.e2e.spec.ts:426`

### 3. Engineering and Architecture Quality

#### 3.1 Structure and module decomposition
- Conclusion: **Pass**
- Rationale: Clear module decomposition with domain-specific services/controllers/resolvers/DTOs/guards and shared packages.
- Evidence: `apps/api/src/app.module.ts:62`, `apps/api/src/community/community.controller.ts:17`, `apps/api/src/pos/pos.service.ts:51`, `apps/api/src/admin/admin.service.ts:76`, `apps/web/src/hooks/useFinanceWorkspace.ts:23`

#### 3.2 Maintainability and extensibility
- Conclusion: **Pass**
- Rationale: Service-level transaction boundaries, shared validation, migration sequencing, chain verification utilities, and role-centric routing support maintainability/extensibility.
- Evidence: `apps/api/src/pos/pos.service.ts:351`, `apps/api/src/moderation/moderation.service.ts:190`, `apps/api/src/audit/audit.service.ts:93`, `packages/db/src/migrations/009_runtime_role_least_privilege.ts:11`, `apps/web/src/routes/ProtectedRoute.tsx:5`

### 4. Engineering Details and Professionalism

#### 4.1 Error handling, logging, validation, API design
- Conclusion: **Pass**
- Rationale: Input validation and controlled error handling are consistently applied; logging includes domain tags and trace IDs with explicit redaction/minimization patterns; CSRF/origin protections and role checks are explicit.
- Evidence: `apps/api/src/main.ts:39`, `apps/api/src/auth/csrf.guard.ts:93`, `apps/api/src/community/dto/community.dto.ts:34`, `apps/api/src/attendance/attendance.service.ts:65`, `apps/api/src/admin/admin.service.ts:135`, `apps/api/src/common/file-upload-exception.filter.ts:26`
- Manual verification note: Deployment-specific proxy trust assumptions still require environment validation.

#### 4.2 Product/service realism
- Conclusion: **Pass**
- Rationale: The codebase is organized as a production-style service with governance controls (append-only logs, least privilege grants, chain signatures, role partitioning).
- Evidence: `packages/db/src/migrations/004_append_only_security.ts:15`, `packages/db/src/migrations/011_chain_signatures.ts:24`, `packages/db/src/migrations/010_domain_constraints_and_user_update_grants.ts:16`, `apps/api/src/admin/admin.controller.ts:25`

### 5. Prompt Understanding and Requirement Fit

#### 5.1 Business semantics and implicit constraints
- Conclusion: **Pass**
- Rationale: The implementation reflects the intended retailer/compliance semantics, including separation of customer visibility vs reader readability, queue-bound moderation governance, and immediate global attendance risk freshness for authorized viewers.
- Evidence: `apps/api/src/catalog/catalog.service.ts:50`, `apps/api/src/catalog/catalog.service.ts:149`, `apps/api/src/moderation/moderation.service.ts:195`, `apps/api/src/moderation/moderation.service.ts:203`, `apps/api/src/attendance/attendance.service.ts:341`, `apps/api/src/attendance/attendance.service.ts:342`

### 6. Aesthetics (frontend-only/full-stack)

#### 6.1 Visual/interaction quality
- Conclusion: **Cannot Confirm Statistically**
- Rationale: Static code indicates deliberate visual hierarchy, interaction states, and responsive grid structures, but final rendering quality must be judged in a browser runtime.
- Evidence: `apps/web/src/pages/customer/LibraryPage.tsx:44`, `apps/web/src/components/community/CommunityDeskPanel.tsx:55`, `apps/web/src/pages/pos/PosPage.tsx:9`, `apps/web/src/pages/admin/FinancePage.tsx:9`
- Manual verification note: Manual desktop/mobile visual QA is required.

## 5. Issues / Suggestions (Severity-Rated)

- No Blocker/High/Medium code defects were found in this static pass.

### 1) Low — Trusted-proxy mode still depends on deployment boundary controls that static audit cannot prove
- Severity: **Low**
- Title: Deployment verification required for forwarded-host trust mode
- Conclusion: **Cannot Confirm Statistically**
- Evidence: `README.md:54`, `apps/api/src/main.ts:20`, `apps/api/src/common/allowed-origins.ts:85`, `apps/api/test/bootstrap-origin.e2e.spec.ts:203`
- Impact: If operators enable `APP_TRUSTED_PROXY_HOPS` without an actual trusted reverse-proxy boundary, forwarded headers could be trusted inappropriately.
- Minimum actionable fix: Keep current code behavior; add deployment hardening guidance/checklist (network ACL/proxy-only ingress/header stripping) in operational docs.

## 6. Security Review Summary

- Authentication entry points: **Pass**
  - Evidence/reasoning: Offline username/password login, password policy, lockout lifecycle, session idle expiry, cookie-only guard path.
  - Evidence: `apps/api/src/auth/auth.controller.ts:32`, `apps/api/src/auth/auth.service.ts:178`, `apps/api/src/auth/auth.service.ts:88`, `apps/api/src/auth/auth.service.ts:291`, `apps/api/src/auth/auth.guard.ts:27`

- Route-level authorization: **Pass**
  - Evidence/reasoning: Controller/resolver guard + role decorator usage is explicit across modules.
  - Evidence: `apps/api/src/community/community.controller.ts:18`, `apps/api/src/attendance/attendance.controller.ts:41`, `apps/api/src/admin/admin.controller.ts:27`, `apps/api/src/catalog/catalog.resolver.ts:13`

- Object-level authorization: **Pass**
  - Evidence/reasoning: Cart ownership checks prevent cross-clerk access; moderation enforces report-target linkage consistency before action.
  - Evidence: `apps/api/src/pos/pos.service.ts:125`, `apps/api/src/pos/pos.service.ts:150`, `apps/api/src/moderation/moderation.service.ts:124`, `apps/api/src/moderation/moderation.service.ts:155`, `apps/api/test/app.community-pos.e2e.spec.ts:1542`

- Function-level authorization: **Pass**
  - Evidence/reasoning: Sensitive function paths are constrained by role and action-specific checks (e.g., moderation suspend role constraints, admin transition role split).
  - Evidence: `apps/api/src/moderation/moderation.service.ts:226`, `apps/api/src/admin/admin.controller.ts:47`, `apps/api/src/admin/admin.controller.ts:58`, `apps/api/src/attendance/attendance.controller.ts:17`

- Tenant / user isolation: **Pass** (single-tenant architecture)
  - Evidence/reasoning: User-scoped profile/cart/risk filtering and ownership checks are present; repository models a single-tenant local deployment.
  - Evidence: `apps/api/src/profiles/profiles.controller.ts:16`, `apps/api/src/attendance/attendance.service.ts:362`, `apps/api/src/pos/pos.service.ts:135`, `apps/api/src/pos/pos.service.ts:166`

- Admin / internal / debug endpoint protection: **Pass**
  - Evidence/reasoning: Admin/moderation/internal surfaces are role-guarded; no unguarded debug endpoints identified.
  - Evidence: `apps/api/src/admin/admin.controller.ts:25`, `apps/api/src/moderation/moderation.controller.ts:10`, `apps/api/src/auth/auth.controller.ts:59`

## 7. Tests and Logging Review

- Unit tests: **Pass**
  - Evidence: Auth/config/origin/moderation/attendance/recommendations unit specs exist and cover core logic.
  - Evidence: `apps/api/src/auth/auth.service.spec.ts:12`, `apps/api/src/config/app-config.spec.ts:1`, `apps/api/src/common/allowed-origins.spec.ts:7`, `apps/api/src/moderation/moderation.service.spec.ts:238`, `apps/api/src/attendance/attendance.service.spec.ts:303`, `apps/api/src/recommendations/recommendations.service.spec.ts:66`

- API/integration tests: **Pass**
  - Evidence: Broad e2e suites cover auth, origin/CSRF, attendance, community/POS, moderation/governance, reconciliation.
  - Evidence: `apps/api/test/app.e2e.spec.ts:430`, `apps/api/test/bootstrap-origin.e2e.spec.ts:138`, `apps/api/test/app.community-pos.e2e.spec.ts:517`, `apps/api/test/app.governance.e2e.spec.ts:507`

- Logging categories / observability: **Pass**
  - Evidence: Structured category-prefixed logs and trace IDs are used in auth/moderation/attendance and request middleware.
  - Evidence: `apps/api/src/auth/auth.service.ts:135`, `apps/api/src/moderation/moderation.service.ts:32`, `apps/api/src/attendance/attendance.service.ts:65`, `apps/api/src/common/request-context.middleware.ts:9`

- Sensitive-data leakage risk in logs/responses: **Pass**
  - Evidence/reasoning: Audit payload minimization/redaction exists; tests assert username redaction in logs and API payload minimization.
  - Evidence: `apps/api/src/admin/admin.service.ts:37`, `apps/api/src/admin/admin.service.ts:135`, `apps/api/src/auth/auth.service.spec.ts:219`, `apps/api/test/app.e2e.spec.ts:1322`

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview
- Unit tests exist: Jest in API and Vitest in web.
  - Evidence: `apps/api/package.json:12`, `apps/web/package.json:9`
- API/integration tests exist: Supertest/Nest e2e by domain.
  - Evidence: `apps/api/test/app.e2e.spec.ts:426`, `apps/api/test/app.community-pos.e2e.spec.ts:426`, `apps/api/test/app.governance.e2e.spec.ts:426`, `apps/api/test/bootstrap-origin.e2e.spec.ts:10`
- Test entry points exist in docs/scripts.
  - Evidence: `README.md:92`, `README.md:103`, `package.json:17`, `package.json:20`, `package.json:21`
- Static boundary: tests were reviewed only, not executed.

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Forged `x-forwarded-host` handling and trusted-proxy mode | `apps/api/test/bootstrap-origin.e2e.spec.ts:138`, `apps/api/test/bootstrap-origin.e2e.spec.ts:203`, `apps/api/src/common/allowed-origins.spec.ts:42` | Reject forged forwarded host when proxy trust off; allow forwarded-host same-origin only with explicit proxy config | sufficient | Deployment path trust remains ops concern | Add deployment smoke checklist test docs (non-unit) |
| CSRF + origin rejection behavior | `apps/api/test/app.e2e.spec.ts:430`, `apps/api/test/app.e2e.spec.ts:472` | Disallowed origin and missing/invalid CSRF token are rejected | sufficient | None material | Keep as regression |
| Customer catalog/community visibility for physical + bundle titles while reader gating unreadable | `apps/api/test/app.community-pos.e2e.spec.ts:517`, `apps/web/src/pages/customer/LibraryPage.test.tsx:95`, `apps/web/src/pages/customer/CommunityPage.test.tsx:203`, `apps/web/src/pages/customer/ReaderPage.test.tsx:255` | Catalog contains PHYSICAL/BUNDLE with `isReadable=false`; community thread works; reader route blocked for unreadable | sufficient | None material | Keep as regression |
| Moderation hide/restore/remove strict queue/report linkage | `apps/api/test/app.governance.e2e.spec.ts:507`, `apps/api/src/moderation/moderation.service.spec.ts:238`, `apps/api/src/moderation/moderation.service.spec.ts:271` | Actions fail without `reportId` or with report lacking comment target; success path works with linked report | sufficient | None material | Keep as regression |
| Attendance global risk freshness for authorized global viewers | `apps/api/test/app.e2e.spec.ts:686`, `apps/api/src/attendance/attendance.service.spec.ts:322` | Manager/global view triggers immediate overdue creation for other-user records; clerk self path stays scoped | sufficient | None material | Keep role matrix + freshness tests |
| Route authorization matrix (401/403) | `apps/api/test/app.e2e.spec.ts:760`, `apps/api/test/app.e2e.spec.ts:850`, `apps/web/src/App.routes.test.tsx:48` | Attendance/profiles/admin access role boundaries enforced | sufficient | None material | Keep with new routes |
| Object-level auth (cart ownership isolation) | `apps/api/test/app.community-pos.e2e.spec.ts:1542` | One clerk cannot mutate/review/checkout another clerk’s cart | sufficient | None material | Extend only when new ownership objects added |
| Community anti-spam and duplicate protections | `apps/api/test/app.community-pos.e2e.spec.ts:770`, `apps/api/test/app.community-pos.e2e.spec.ts:821`, `apps/api/test/app.community-pos.e2e.spec.ts:869` | Max comments/minute and duplicate-window conflict behavior validated | sufficient | None material | Keep concurrency cases |
| Recommendation local fallback/cache/trace path | `apps/api/src/recommendations/recommendations.service.spec.ts:92`, `apps/api/src/recommendations/recommendations.service.spec.ts:152`, `apps/api/test/app.community-pos.e2e.spec.ts:1047` | 150ms timeout fallback + empty-snapshot fallback + trace strategy logging | sufficient | Runtime latency not statically measurable | Optional performance suite in runtime validation phase |
| Tamper-evident chain integrity and append-only behavior | `apps/api/test/app.governance.e2e.spec.ts:1007`, `apps/api/test/app.governance.e2e.spec.ts:1088`, `apps/api/test/app.community-pos.e2e.spec.ts:1609` | Forged/missing signatures detected; updates/deletes rejected for immutable tables | sufficient | None material | Keep integrity regression tests |

### 8.3 Security Coverage Audit
- Authentication: **Covered sufficiently**
  - Tests meaningfully cover invalid credentials, lockout threshold, idle session expiry, and bearer-only rejection on browser routes.
  - Evidence: `apps/api/test/app.e2e.spec.ts:887`, `apps/api/test/app.e2e.spec.ts:948`, `apps/api/test/app.e2e.spec.ts:813`
- Route authorization: **Covered sufficiently**
  - Role matrices and endpoint-level 403 expectations are present.
  - Evidence: `apps/api/test/app.e2e.spec.ts:760`, `apps/api/test/app.e2e.spec.ts:850`
- Object-level authorization: **Covered sufficiently**
  - Ownership and report-target linkage behavior are tested for sensitive object mutations.
  - Evidence: `apps/api/test/app.community-pos.e2e.spec.ts:1542`, `apps/api/test/app.governance.e2e.spec.ts:507`
- Tenant / data isolation: **Basically covered (single-tenant model)**
  - User-scoped access tests exist for profile/cart/risk paths; no multi-tenant model is defined.
  - Evidence: `apps/api/test/app.e2e.spec.ts:850`, `apps/api/test/app.community-pos.e2e.spec.ts:1542`, `apps/api/src/attendance/attendance.service.ts:362`
- Admin / internal protection: **Covered sufficiently**
  - Admin/moderation paths are guarded and tested for role restrictions.
  - Evidence: `apps/api/test/app.e2e.spec.ts:1044`, `apps/api/src/admin/admin.controller.ts:27`, `apps/api/src/moderation/moderation.controller.ts:12`

### 8.4 Final Coverage Judgment
- **Pass**
- Covered major risks:
  - Origin/CSRF hardening including forged forwarded-host scenarios,
  - Auth/session/lockout and RBAC matrices,
  - Object-level cart isolation,
  - Queue-bound moderation enforcement,
  - Immediate global attendance risk freshness,
  - Physical/bundle catalog/community visibility with reader gating,
  - Governance integrity (append-only + chain-signature verification).
- Remaining boundary:
  - Deployment-specific trusted-proxy network boundary cannot be proven by static tests alone.

## 9. Final Notes
- This is a static-only audit. Runtime behavior was not claimed where execution is required.
- No outstanding Blocker/High/Medium defects were identified in the reviewed scope.
- Residual uncertainty is operational/deployment-bound (trusted proxy ingress assumptions, runtime UX/perf validation), not a code-level regression in the audited repository state.
