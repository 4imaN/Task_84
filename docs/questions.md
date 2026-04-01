# LedgerRead Architecture & Logic Questions

## 1. Delivery & Protection of Digital Assets (DRM)
**What sounded ambiguous:** How are digital titles securely delivered and stored in an "offline-first" environment so they aren’t trivially pirated?
**How it was understood:** The content must be cached to their browser securely without requiring an active internet connection.
**How it was solved:** Digital titles will be downloaded via the local network and stored locally inside the browser using IndexedDB. The content is AES-encrypted using a key derived from the user's local profile.

## 2. Peer-to-Peer vs. Centralized LAN Sync
**What sounded ambiguous:** "optional LAN sync... with conflict resolution preferring the newest timestamp." Does this imply device-to-device (P2P via WebRTC) syncing or a central LAN server?
**How it was understood:** WebRTC P2P in an offline retail setting can be unreliable for state syncing without a proper signaling server.
**How it was solved:** The LAN sync connects to the central NestJS backend server hosted within the retail store. When a device connects, it pushes its local profile payload; the server resolves conflicts using timestamps.

## 3. Moderation Ownership
**What sounded ambiguous:** Customers report community content, but who actions these reports?
**How it was understood:** A moderated community requires a dedicated moderation queue and permissions, which doesn't fit standard clerk duties.
**How it was solved:** Introduce an explicit `MODERATOR` role. There will be a dedicated dashboard specifically for reviewing reported content, resolving community flags, and managing user access (mutes/blocks).

## 4. Offline Checkout Console & Payment Processing
**What sounded ambiguous:** Operations "review totals" to prevent tampering. Does this console integrate with actual payment gateways?
**How it was understood:** Payment gateways fail in "offline-first" environments.
**How it was solved:** The checkout console will stop at a "Record Payment" step. The clerk manually logs the payment method used (e.g., "Cash", "External Terminal ID"). No outbound network requests to third-party processors occur.

## 5. Supplier Data Ingestion in an Offline Environment
**What sounded ambiguous:** Finance staff review "supplier settlement status" and "discrepancies." How does supplier data enter an offline system?
**How it was understood:** Automated API hooks to publishers will fail. Batch data must be ingested manually.
**How it was solved:** The UI will include a File Import module. Managers upload supplier manifests (CSVs/JSONs) manually via local file picking. The system compares the imported manifest against local sales.

## 6. Scope of "Auditable Governance"
**What sounded ambiguous:** Auditable governance is required, but what exactly is being audited? Every user click?
**How it was understood:** Auditing every page turn will bloat storage. Auditing should strictly cover financial, security, and inventory mutations.
**How it was solved:** Implement strict database-level audit logging exclusively for: Cart checkouts (financial), Inventory updates, Moderation bans, and Role assignments.

## 7. Reading Profile Encryption Keys
**What sounded ambiguous:** Exported reading profiles must be "encrypted." How is the encryption key managed?
**How it was understood:** The encryption must be user-controlled since an offline target device has no connectivity to verify keys with a server.
**How it was solved:** When exporting a profile, the UI prompts the user to create an "Export Password." This password encrypts the payload symmetrically.

## 8. Attendance Modeling Target Roles
**What sounded ambiguous:** The backend prompt mentions "Attendance modeling stores clock-in/out events" but doesn't clarify who exactly tracks attendance.
**How it was understood:** Customers do not clock in. Only store staff (Clerks, Managers, Moderators) require attendance tracking.
**How it was solved:** The attendance entity is strictly mapped to staff role tables. Clock-in endpoints will return a `403 Forbidden` if a standard customer attempts to invoke them.

## 9. Tamper-Evident Hash Chain Logic
**What sounded ambiguous:** "each record links into a tamper-evident chain using hash signatures" needs an explicit cryptologic definition.
**How it was understood:** To prevent a rogue admin from altering past attendance/audit records without breaking the chain, a blockchain-style linked hash is required.
**How it was solved:** Upon inserting a new record, the system computes a SHA-256 hash encompassing the current record's payload PLUS the `previous_record_hash`. Validating the table requires recalculating the chain sequentially.

## 10. REST vs GraphQL Delineation
**What sounded ambiguous:** "REST/GraphQL API layer" could imply duplication of all endpoints across both specs.
**How it was understood:** Duplicating all functionality (like file uploads and auth) in GraphQL is unnecessary and slows down development.
**How it was solved:** Use standard REST for transactional mutations (Auth, File Uploads, Checkout, Moderation) and reserve GraphQL exclusively for complex, heavily-nested read queries (like the high-performance catalog, recommendations, and community threads).

## 11. Offline File Storage for Evidence
**What sounded ambiguous:** "attached screenshot evidence files" - where do these live securely in an offline system?
**How it was understood:** Cloud buckets (S3) are unavailable.
**How it was solved:** Files are saved to a dedicated Docker volume mounted to the NestJS container. The system stores the absolute file path, MIME type, and SHA-256 checksum in PostgreSQL for explicit offline retrieval and validation.

## 12. UI/UX Ecosystem and Visual Layout
**What sounded ambiguous:** "The React web interface serves three primary experiences..." but there are no details on the visual design language or layout partitioning.
**How it was understood:** A staff checkout console on a backroom monitor requires a massively different layout structure than a high-performance book reader used on a customer's mobile device or tablet.
**How it was solved:** Adopted a unified component design system (like TailwindCSS + Shadcn). The application mounts entirely different layout wrappers based on the route context: a minimalist, distraction-free layout for the E-Reader, a responsive feed for the Community, and an intricate, data-dense Sidebar layout for the Staff Dashboard.

## 13. Route Separation and Dedicated Logins
**What sounded ambiguous:** "The React web interface serves three primary experiences..." implies a monolithic interface, blurring the lines between Customer access and Staff/Admin access.
**How it was understood:** Having a single unified login page for both a public Customer reading a book and a Finance Manager auditing the offline ledger introduces severe discovery and privilege escalation risks.
**How it was solved:** The React frontend is logically partitioned. Staff and Customers have explicitly dedicated, separate login pages (e.g., `/login` vs `/internal/auth`). Upon authentication, they are locked into entirely segregated route trees to guarantee security isolation.

## 14. Scope of Global Theme Toggles (Night Mode)
**What sounded ambiguous:** "Readers can open a title... and tune preferences including... theme presets, night mode." It was unclear if this visual toggle explicitly applied to just the inner book canvas or the entire application shell.
**How it was understood:** If a user activates night mode to read in the dark, but the surrounding React navigation menus remain bright white, the accessibility benefit is destroyed by immediate eye strain.
**How it was solved:** Night Mode is explicitly built as a global contextual state (e.g., utilizing standard Tailwind `dark` class wrappers on the root `<html>` node) that simultaneously inverts the color palettes of both the core E-Reader canvas AND all surrounding application UI, creating a unified dark experience.

## 15. Night Mode Accessibility for Internal Staff
**What sounded ambiguous:** The original prompt mentions "Night Mode" exclusively in the context of the E-Reader application ("Readers can open a title... and tune preferences...").
**How it was understood:** Confining the dark mode toggle strictly to the Customer E-Reader means a Store Clerk working a dark warehouse shift, or a Manager auditing financial tables at night, would be blinded by the dense white administrative dashboards.
**How it was solved:** The Night Mode toggle was decoupled from the E-Reader component and elevated to a top-level application navigation component, making it universally accessible across all 4 distinct role workspaces (Customer, Clerk, Moderator, Manager).

## 16. Manual SKU Entry UX (Auto-complete)
**What sounded ambiguous:** "Store clerks build carts by selecting SKUs..." It was unclear how the clerk handles items that cannot be scanned or when a scanner is absent.
**How it was understood:** Relying on a clerk to manually type long, numeric SKUs for every item introduces significant room for error and slows down the checkout line.
**How it was solved:** The Clerk's POS interface was designed with a "Quick Search" utility. As the clerk types into the SKU/Title field, the system performs a local type-ahead search, providing a filtered dropdown of matching inventory items for instant selection.
