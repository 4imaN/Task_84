# LedgerRead Static Delivery Acceptance & Architecture Audit

## 1. Verdict
- Overall conclusion: **Partial Pass**

## 2. Scope and Static Verification Boundary
- What was reviewed:
  - Delivery docs, startup/test scripts, and manifests (`README.md:5`, `package.json:9`, `apps/api/package.json:5`, `apps/web/package.json:5`, `docker-compose.yml:1`).
  - Backend entry points, guards, auth/session/CSRF, domain services, DTO validation, migrations, seed/migrate scripts (`apps/api/src/main.ts:16`, `apps/api/src/auth/auth.service.ts:147`, `apps/api/src/auth/csrf.guard.ts:75`, `apps/api/src/pos/pos.service.ts:464`, `apps/api/src/attendance/attendance.service.ts:209`, `packages/db/src/migrations/001_initial_schema.ts:9`).
  - Frontend route/access structure and core experience pages/hooks/components (`apps/web/src/App.tsx:27`, `apps/web/src/routes/ProtectedRoute.tsx:1`, `apps/web/src/pages/customer/ReaderPage.tsx:73`, `apps/web/src/pages/customer/ProfilePortabilityPage.tsx:136`, `apps/web/src/pages/pos/PosPage.tsx:9`).
  - Unit and integration/e2e test suites statically (`apps/api/test/app.e2e.spec.ts:426`, `apps/api/test/app.community-pos.e2e.spec.ts:426`, `apps/api/test/app.governance.e2e.spec.ts:426`, `apps/web/src/pages/customer/ProfilePortabilityPage.test.tsx:68`).
- What was not reviewed:
  - Runtime behavior under actual network/browser/container execution.
  - Performance characteristics (reader “high-performance” latency, 150ms timeout behavior under real load, UI rendering/perceived quality).
- What was intentionally not executed:
  - Project startup, Docker, tests, and external services (per audit constraints).
- Claims requiring manual verification:
  - Real-world exploitability of origin-host trust behavior behind the actual deployment proxy path.
  - End-to-end UX/perf quality for reader/community/POS in browsers.

## 3. Repository / Requirement Mapping Summary
- Prompt core goal (mapped): offline-first local commerce + compliance platform with customer reader/community + staff POS + auditable governance.
- Core flows mapped statically:
  - Reader/preferences/profile sync/portability (`apps/web/src/hooks/useReaderWorkspace.ts:180`, `apps/web/src/pages/customer/ProfilePortabilityPage.tsx:42`, `apps/api/src/profiles/profiles.service.ts:110`).
  - Community moderation and anti-spam (`apps/api/src/community/community.service.ts:86`, `apps/api/src/moderation/moderation.service.ts:187`).
  - POS review-before-checkout + reconciliation/valuation (`apps/api/src/pos/pos.service.ts:464`, `apps/api/src/admin/admin.service.ts:167`).
  - Attendance/evidence/risk-chain and audit-chain integrity (`apps/api/src/attendance/attendance.service.ts:162`, `apps/api/src/audit/audit.service.ts:93`, `packages/db/src/migrations/011_chain_signatures.ts:13`).
  - Local recommendations with nightly refresh/cache/fallback/trace (`apps/api/src/recommendations/recommendations.service.ts:47`, `apps/api/src/recommendations/recommendations.service.ts:168`).

## 4. Section-by-section Review

### 1. Hard Gates

#### 1.1 Documentation and static verifiability
- Conclusion: **Pass**
- Rationale: Startup, environment, role accounts, and test commands are documented; scripts and manifests are statically consistent with docs.
- Evidence: `README.md:5`, `README.md:68`, `README.md:91`, `package.json:9`, `scripts/run-api-tests.mjs:104`, `docker-compose.yml:19`
- Manual verification note: Runtime success of documented commands still requires manual execution.

#### 1.2 Material deviation from Prompt
- Conclusion: **Partial Pass**
- Rationale: Major prompt domains are implemented, but customer catalog/community surface intentionally excludes non-readable physical/bundle titles, which narrows requirement fit for a retailer selling digital + physical titles.
- Evidence: `apps/api/src/catalog/catalog.service.ts:46`, `apps/api/src/catalog/catalog.service.ts:102`, `apps/api/test/app.community-pos.e2e.spec.ts:527`, `apps/api/src/scripts/seed.ts:437`
- Manual verification note: Confirm business intent whether customer-facing catalog/community should include physical/bundle titles with non-reader behavior.

### 2. Delivery Completeness

#### 2.1 Coverage of explicit core requirements
- Conclusion: **Partial Pass**
- Rationale: Most explicit functional/security requirements are implemented (auth policy, session/lockout, CSRF, reader prefs, profile sync, moderation actions, anti-spam, POS review/checkout validation, reconciliation thresholds, recommendations), but there are governance/security gaps and a scope narrowing in customer title exposure.
- Evidence: `apps/api/src/auth/auth.service.ts:158`, `apps/api/src/auth/auth.service.ts:291`, `apps/api/src/community/community.service.ts:96`, `apps/api/src/pos/pos.service.ts:557`, `apps/api/src/admin/admin.service.ts:261`, `apps/api/src/recommendations/recommendations.service.ts:187`, `apps/api/src/moderation/moderation.service.ts:191`
- Manual verification note: Visual/interaction quality and real runtime behavior remain manual.

#### 2.2 Basic end-to-end deliverable (0→1)
- Conclusion: **Pass**
- Rationale: Complete monorepo structure exists with API/web/shared packages, migrations/seeds, Docker startup path, and substantial tests/docs.
- Evidence: `README.md:150`, `package.json:5`, `apps/api/src/main.ts:93`, `apps/web/src/App.tsx:27`, `packages/db/src/migrations/index.ts:15`

### 3. Engineering and Architecture Quality

#### 3.1 Structure and module decomposition
- Conclusion: **Pass**
- Rationale: Domain modules are clearly split across auth/community/pos/attendance/admin/recommendations with dedicated DTOs, guards, and services.
- Evidence: `apps/api/src/app.module.ts:62`, `apps/api/src/community/community.controller.ts:17`, `apps/api/src/pos/pos.service.ts:51`, `apps/api/src/admin/admin.service.ts:76`, `apps/web/src/pages/admin/FinancePage.tsx:5`

#### 3.2 Maintainability and extensibility
- Conclusion: **Partial Pass**
- Rationale: Overall maintainable and extensible patterns exist (transaction boundaries, service decomposition, migrations, typed contracts), but moderation workflow integrity is underconstrained because key actions are not queue-bound by schema/API contract.
- Evidence: `apps/api/src/moderation/dto/moderation.dto.ts:5`, `apps/api/src/moderation/moderation.service.ts:191`, `apps/api/src/moderation/moderation.service.ts:254`

### 4. Engineering Details and Professionalism

#### 4.1 Error handling, logging, validation, API design
- Conclusion: **Partial Pass**
- Rationale: Input validation, role guards, conflict handling, and trace-aware logging are broadly solid; however, origin allowlisting trusts forwarded host headers without explicit trusted-proxy constraints, and attendance risk evaluation freshness is inconsistent for global viewers.
- Evidence: `apps/api/src/auth/csrf.guard.ts:47`, `apps/api/src/common/allowed-origins.ts:68`, `apps/api/src/main.ts:21`, `apps/api/src/attendance/attendance.service.ts:341`, `apps/api/src/attendance/attendance.service.ts:361`
- Manual verification note: Exploitability of forwarded-header trust depends on deployment proxy/header sanitization.

#### 4.2 Product-grade organization (vs demo)
- Conclusion: **Pass**
- Rationale: Delivery resembles a real product stack (RBAC, migrations, least-privilege grants, append-only controls, comprehensive tests).
- Evidence: `packages/db/src/migrations/009_runtime_role_least_privilege.ts:21`, `packages/db/src/migrations/004_append_only_security.ts:15`, `apps/api/test/app.governance.e2e.spec.ts:962`

### 5. Prompt Understanding and Requirement Fit

#### 5.1 Business goal and constraint fidelity
- Conclusion: **Partial Pass**
- Rationale: Core compliance-commerce workflow is implemented with strong local governance mechanics, but customer-facing title scope and moderation queue enforcement semantics diverge from stricter prompt interpretation.
- Evidence: `apps/api/src/catalog/catalog.service.ts:102`, `apps/api/src/moderation/moderation.service.ts:195`, `apps/api/src/moderation/moderation.service.ts:219`

### 6. Aesthetics (frontend/full-stack)

#### 6.1 Visual/interaction quality fit
- Conclusion: **Cannot Confirm Statistically**
- Rationale: Static code shows deliberate layout hierarchy, themed panels, and interaction states, but final visual quality/responsiveness/accessibility perception requires running UI.
- Evidence: `apps/web/src/pages/customer/LibraryPage.tsx:44`, `apps/web/src/components/pos/PosReviewPanel.tsx:33`, `apps/web/src/components/community/CommunityDeskPanel.tsx:100`
- Manual verification note: Browser-based visual QA on desktop/mobile is required.

## 5. Issues / Suggestions (Severity-Rated)

### 1) High — Origin validation trusts `x-forwarded-host` without explicit trusted-proxy boundary
- Conclusion: **Suspected Risk / Partial Fail**
- Evidence: `apps/api/src/common/allowed-origins.ts:68`, `apps/api/src/common/allowed-origins.ts:76`, `apps/api/src/main.ts:21`, `apps/api/src/auth/csrf.guard.ts:47`
- Impact: If untrusted forwarded headers reach app code, origin allowlisting decisions for login/mutations may be spoofable, weakening CSRF/origin protections.
- Minimum actionable fix:
  - Only honor `x-forwarded-host` when behind an explicitly trusted proxy path.
  - Prefer server-resolved canonical host context; otherwise use `Host` only.
  - Add explicit tests for forged forwarded-host scenarios.
- Minimal verification path:
  - Manual verification required in deployed topology with/without proxy header sanitization.

### 2) High — Customer catalog/community pipeline excludes physical/bundle titles
- Conclusion: **Fail (Prompt-Fit Gap)**
- Evidence: `apps/api/src/catalog/catalog.service.ts:46`, `apps/api/src/catalog/catalog.service.ts:102`, `apps/api/test/app.community-pos.e2e.spec.ts:527`, `apps/api/src/scripts/seed.ts:437`
- Impact: Customer-facing flows (including community entry selection) are effectively constrained to readable digital titles, reducing requirement fit for a retailer selling digital and physical titles.
- Minimum actionable fix:
  - Return full catalog inventory for customer browse/community selection.
  - Keep reader entry gated by `isReadable`/format checks rather than filtering catalog payloads.
  - Add API/UI tests confirming physical/bundle visibility with reader-disabled behavior.
- Minimal verification path:
  - Manual UI/API verification that physical/bundle appear in customer catalog/community while reader rejects unreadable titles.

### 3) Medium — Moderation actions are not strictly queue-bound for hide/restore/remove
- Conclusion: **Partial Fail**
- Evidence: `apps/api/src/moderation/dto/moderation.dto.ts:5`, `apps/api/src/moderation/moderation.service.ts:191`, `apps/api/src/moderation/moderation.service.ts:219`, `apps/api/src/moderation/moderation.service.ts:254`
- Impact: Moderators can take certain actions without report linkage, weakening queue-driven governance traceability.
- Minimum actionable fix:
  - Require `reportId` for all moderation actions, or add explicit policy controls and stronger audit constraints for direct actions.
- Minimal verification path:
  - Add tests that reject hide/restore/remove without `reportId` (or validate explicit approved-direct-action policy).

### 4) Medium — Global attendance risk views trigger on-demand overdue evaluation only for requestor
- Conclusion: **Partial Fail**
- Evidence: `apps/api/src/attendance/attendance.service.ts:334`, `apps/api/src/attendance/attendance.service.ts:341`, `apps/api/src/attendance/attendance.service.ts:361`, `apps/api/src/attendance/attendance.service.ts:140`
- Impact: Manager/finance/inventory risk views can miss newly overdue other-user records until scheduled cron runs.
- Minimum actionable fix:
  - Use `evaluateOverdueClockOuts(undefined)` for global viewers and `evaluateOverdueClockOuts(user.id)` only for clerk self-view.
- Minimal verification path:
  - Add integration test proving manager risk read immediately surfaces newly overdue records for other users.

## 6. Security Review Summary

- Authentication entry points: **Pass**
  - Evidence: cookie-only auth/session lifecycle and policy checks (`apps/api/src/auth/auth.controller.ts:32`, `apps/api/src/auth/auth.service.ts:178`, `apps/api/src/auth/auth.service.ts:291`).
- Route-level authorization: **Pass**
  - Evidence: guard + role decorators across controllers/resolvers (`apps/api/src/community/community.controller.ts:18`, `apps/api/src/pos/pos.controller.ts:17`, `apps/api/src/admin/admin.controller.ts:26`, `apps/api/src/catalog/catalog.resolver.ts:13`).
- Object-level authorization: **Partial Pass**
  - Evidence: strong cart ownership checks (`apps/api/src/pos/pos.service.ts:135`, `apps/api/src/pos/pos.service.ts:166`), but moderation/report linkage not strictly enforced (`apps/api/src/moderation/moderation.service.ts:191`).
- Function-level authorization: **Partial Pass**
  - Evidence: action-level role restrictions exist (`apps/api/src/admin/admin.controller.ts:31`, `apps/api/src/admin/admin.controller.ts:46`, `apps/api/src/attendance/attendance.controller.ts:16`), with moderation workflow control gap noted above.
- Tenant / user data isolation: **Partial Pass**
  - Evidence: user-scoped profile/cart/risk filters exist (`apps/api/src/profiles/profiles.service.ts:55`, `apps/api/src/pos/pos.service.ts:125`, `apps/api/src/attendance/attendance.service.ts:361`); system appears single-tenant, so tenant isolation is mostly not applicable by design.
- Admin / internal / debug protection: **Partial Pass**
  - Evidence: privileged routes are role-guarded (`apps/api/src/admin/admin.controller.ts:27`, `apps/api/src/moderation/moderation.controller.ts:12`), but origin trust boundary needs hardening for proxy headers (`apps/api/src/common/allowed-origins.ts:68`).

## 7. Tests and Logging Review

- Unit tests: **Pass**
  - Evidence: broad service-level unit coverage across auth/catalog/community/pos/attendance/admin/recommendations (`apps/api/src/auth/auth.service.spec.ts:1`, `apps/api/src/catalog/catalog.service.spec.ts:6`, `apps/api/src/recommendations/recommendations.service.spec.ts:3`).
- API / integration tests: **Pass (with targeted gaps)**
  - Evidence: domain-split e2e suites for auth/admin/community-pos/governance (`apps/api/test/app.e2e.spec.ts:98`, `apps/api/test/app.community-pos.e2e.spec.ts:98`, `apps/api/test/app.governance.e2e.spec.ts:98`).
- Logging categories / observability: **Pass**
  - Evidence: structured category-prefixed logs and trace IDs (`apps/api/src/auth/auth.service.ts:135`, `apps/api/src/attendance/attendance.service.ts:65`, `apps/api/src/moderation/moderation.service.ts:32`, `apps/api/src/common/request-context.middleware.ts:9`).
- Sensitive-data leakage risk in logs / responses: **Partial Pass**
  - Evidence: audit payload redaction/minimization and role-projection are implemented (`apps/api/src/admin/admin.service.ts:37`, `apps/api/src/admin/admin.service.ts:135`, `apps/api/test/app.e2e.spec.ts:1237`), but proxy-origin trust remains a separate security concern.

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview
- Unit tests exist:
  - API unit via Jest (`apps/api/package.json:12`).
  - Web unit/component via Vitest (`apps/web/package.json:9`).
- API/integration tests exist:
  - Supertest/Nest e2e suites (`apps/api/test/app.e2e.spec.ts:98`, `apps/api/test/app.community-pos.e2e.spec.ts:98`, `apps/api/test/app.governance.e2e.spec.ts:98`).
- Test entry points documented:
  - Backend and frontend commands in README (`README.md:91`, `README.md:102`).
  - Root scripts (`package.json:17`, `package.json:20`, `package.json:21`).
- Static boundary:
  - Tests were reviewed but not executed in this audit.

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Auth 401/lockout/session expiry | `apps/api/test/app.e2e.spec.ts:426`, `apps/api/test/app.e2e.spec.ts:802`, `apps/api/test/app.e2e.spec.ts:863` | Reject unauthenticated session; lockout and parallel failed-attempt behavior | sufficient | None material | Keep regression tests as-is |
| CSRF + origin enforcement | `apps/api/test/app.e2e.spec.ts:430`, `apps/api/test/app.e2e.spec.ts:461`, `apps/api/test/bootstrap-origin.e2e.spec.ts:58` | Disallowed origin rejected; missing/invalid CSRF rejected | basically covered | No explicit forged `x-forwarded-host` coverage | Add negative tests for spoofed forwarded-host combinations |
| Route authorization (401/403) | `apps/api/test/app.e2e.spec.ts:675`, `apps/api/test/app.e2e.spec.ts:765`, `apps/api/test/app.e2e.spec.ts:959` | Role boundary checks on attendance/profiles/admin flows | sufficient | None material | Keep role-matrix tests updated |
| Object-level authorization (cart ownership) | `apps/api/test/app.community-pos.e2e.spec.ts:1525` | Different clerk cannot modify/review/checkout another clerk cart | sufficient | None material | Add similar ownership tests for any new object-scoped endpoints |
| Community anti-spam/duplicate/report validation | `apps/api/test/app.community-pos.e2e.spec.ts:753`, `apps/api/test/app.community-pos.e2e.spec.ts:804`, `apps/api/test/app.community-pos.e2e.spec.ts:919` | Sensitive words/rate limits/duplicate window and report metadata checks | sufficient | None material | Keep stress-path concurrency tests |
| POS review-before-checkout tamper prevention | `apps/api/test/app.community-pos.e2e.spec.ts:1190`, `apps/api/test/app.community-pos.e2e.spec.ts:1415` | Checkout blocked without fresh review; concurrent updates serialized | sufficient | None material | Add price-change race test if pricing rules evolve |
| Reconciliation thresholds + moving-average valuation | `apps/api/test/app.governance.e2e.spec.ts:426`, `apps/api/test/app.governance.e2e.spec.ts:670` | Discrepancy count + valuation formula asserted | sufficient | None material | Maintain fixture determinism for valuation arithmetic |
| Tamper-evident chain signatures/integrity | `apps/api/test/app.governance.e2e.spec.ts:962`, `apps/api/test/app.governance.e2e.spec.ts:1043`, `apps/api/test/app.governance.e2e.spec.ts:1099` | Forged rows/signature tampering detected; missing signatures rejected | sufficient | None material | Keep signature-forgery regression coverage |
| Recommendations fallback/cache/trace | `apps/api/src/recommendations/recommendations.service.spec.ts:92`, `apps/api/src/recommendations/recommendations.service.spec.ts:123`, `apps/api/test/app.community-pos.e2e.spec.ts:1030` | 150ms timeout fallback + trace strategy checks | sufficient | Runtime perf under load not statically provable | Add load/perf tests in non-static verification phase |
| Moderation queue governance binding | `apps/api/test/app.governance.e2e.spec.ts:495`, `apps/api/src/moderation/moderation.service.spec.ts:212` | Queue flow and suspend/report coupling covered | insufficient | No failing test for hide/restore/remove without `reportId` | Add API/unit tests enforcing queue linkage for all moderation actions |
| Attendance global risk freshness | `apps/api/src/attendance/attendance.service.spec.ts:288`, `apps/api/test/app.e2e.spec.ts:675` | Scheduled overdue creation + role access checks | insufficient | No test proving manager view triggers overdue evaluation for other users | Add e2e for manager immediate visibility of overdue clerk alerts |
| Customer scope for physical/bundle in catalog/community | `apps/api/test/app.community-pos.e2e.spec.ts:527` | Current tests assert digital-only catalog behavior | insufficient vs prompt-fit | Coverage confirms narrowed behavior but not prompt-wide title access | Add tests requiring physical/bundle catalog/community visibility with reader-disabled routing |

### 8.3 Security Coverage Audit
- Authentication: **Meaningfully covered**
  - Lockout/session/401/bearer rejection covered (`apps/api/test/app.e2e.spec.ts:728`, `apps/api/test/app.e2e.spec.ts:802`).
- Route authorization: **Meaningfully covered**
  - Multiple role matrices covered (`apps/api/test/app.e2e.spec.ts:675`, `apps/api/test/app.e2e.spec.ts:959`).
- Object-level authorization: **Partially covered**
  - Strong cart ownership checks exist (`apps/api/test/app.community-pos.e2e.spec.ts:1525`), but moderation queue-binding gaps remain.
- Tenant / data isolation: **Partially covered**
  - User isolation for profiles/cart/risk mostly covered; no explicit tenant model tests (single-tenant design).
- Admin / internal protection: **Partially covered**
  - Admin role boundaries and audit redaction tested; forwarded-header origin trust edge is not covered.

### 8.4 Final Coverage Judgment
- **Partial Pass**
- Covered major risks:
  - auth/lockout/session, route RBAC, POS tamper checks, reconciliation arithmetic, append-only/hash-chain integrity, recommendation fallback behavior.
- Uncovered/undercovered risks where severe defects could remain:
  - forwarded-header origin trust path,
  - strict moderation queue linkage for non-suspend actions,
  - immediate global risk freshness behavior,
  - prompt-fit expectations for customer visibility of physical/bundle titles.

## 9. Final Notes
- This report is static-only and does not claim runtime success.
- Findings were consolidated to root causes; repeated symptoms were intentionally merged.
- Where static proof is insufficient (notably proxy/header deployment behavior and UI runtime quality), items were marked as suspected risk or manual verification required.
