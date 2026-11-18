# SsibuChat — Complete Implementation Roadmap and Acceptance Register

This is the live delivery register for the A+B+C mandate. A phase is complete only when implementation, security, tests, operational configuration and acceptance criteria are all satisfied. A screen, API stub or draft PR is not production completion.

## A+B+C governance invariants

1. Upgrade PTU-hosted SsibuChat in `payteamuniversity/payteam`, preserving PTU authentication, routes, integrations and MAC authority for PTU testers.
2. Build independent SsibuChat in `ssibuchat/ssibuchat`, with independent identity, database, admin and tester controls.
3. Keep the deployments isolated: separate secrets, sessions, databases, releases, monitoring and rollback. No silent cross-deployment changes.
4. PTU MAC must never authorize independent testers. Independent admin must never replace PTU MAC for PTU testers.
5. Provider-dependent or regulated functions remain unavailable until provider credentials, verification, compliance and runtime acceptance are complete.

## Phase 0 — Baseline, governance and safety

- [x] Confirm A+B+C architecture and deployment boundary.
- [x] Inspect both GitHub repositories and record the independent repository baseline.
- [x] Record PTU MAC vs independent admin tester-control boundary.
- [x] Create architecture, global product audit, roadmap, security, operations and implementation-status documents.
- [ ] Verify live Vercel projects, domains, environment names, owners and production deployment targets.
- [ ] Verify both MongoDB Atlas projects, users, network rules, backups, restore capability and indexes.
- [ ] Establish named operational owners, threat model, data inventory, SLOs, incident response and release approval process.
- [ ] Establish deployment-specific smoke tests and cross-deployment contract tests.

## Phase 1 — Independent identity, access and application foundation

- [x] React/Vite independent application, Node API entry point, MongoDB connection and health endpoint.
- [x] Independent account registration, scrypt password hashing, login/logout and opaque server-side sessions.
- [x] One-time independent administrator bootstrap requiring deployment secrets.
- [x] Independent tester accounts, enable/disable policy and session revocation; no PTU MAC dependency.
- [x] Fail-closed same-origin checks for cookie-authenticated mutations, comparing scheme and host, with same-origin Referer fallback.
- [x] Persistent MongoDB-backed throttling for bootstrap, registration, login, thread starts, message sends, module writes and AI requests.
- [x] Owner/tenant-scoped module record boundaries and indexes.
- [ ] Complete tenant membership/role model, schema-versioned migrations and admin audit UI.
- [ ] Account email verification, password recovery, passkeys, device/session management and security notifications.
- [x] TOTP MFA enrollment/confirmation, AES-256-GCM encrypted secrets, one-time recovery codes, login challenge verification and disable/revocation flow (automated primitive tests; API integration acceptance pending).
- [ ] Distributed abuse controls for all sensitive endpoints, signup abuse, content/reporting and API quotas.
- [x] GitHub Actions CI: 14 unit tests passed, Vite build passed on validated commit `bfc81f4d5279aedc41b240d0dab5b2842432bba0`.
- [x] Production dependency audit on that validated commit: zero production dependency vulnerabilities.
- [ ] Commit a deterministic package lockfile and switch CI/release installs to `npm ci`.
- [ ] Resolve/reassess the four high-severity dev-toolchain findings involving picomatch when a patched upstream release is available; do not suppress or misrepresent them.
- [ ] Add lint, typecheck, API integration, browser E2E, accessibility and load tests.
- [x] Verify current branch head `bdc8bdae3b19749e03199e410fbc5094a10a921f`: 15 tests passed, production build passed, and production dependency audit found zero vulnerabilities.
- [ ] WCAG 2.2 AA audit, keyboard navigation, screen-reader checks, contrast, focus management and reduced-motion support.

## Phase 2 — Connect

### Delivered foundation
- [x] Direct and group thread creation.
- [x] Tenant-scoped username discovery.
- [x] Thread listing and participant-authorized message history.
- [x] Participant-authorized message submission.
- [x] Idempotency keys for message submission.
- [x] Retry handling that repairs thread summary/count and upserts the accepted-message outbox event.
- [x] Unique outbox event identity index.

### Still required
- [ ] Per-recipient accepted/sent/delivered/read/failed state and receipts.
- [ ] Reliable fan-out worker, retry schedule, dead-letter queue and outbox consumer.
- [ ] Push realtime, typing/presence, cursor sync, reconnect and polling fallback.
- [ ] Group administration: creator/admin roles, member add/remove, invite links, join approval, group settings and history policy.
- [ ] Contacts, block/report, abuse moderation, privacy/discovery controls and user directory pagination.
- [ ] Message edit/delete, reactions, replies, pins, search and export.
- [ ] Attachment upload/download, malware scan and authorized previews.
- [ ] Channels, communities, moderation, membership and publishing.
- [ ] Provider-authenticated inbound SMS, replay protection, quotas and idempotent callback handling.
- [ ] Email/SMS delivery adapters, recipient consent, opt-out and delivery logs.
- [ ] E2EE protocol, audited cryptographic design, device identity, group key rotation and recovery model.

## Phase 3 — Media and status

- [ ] Object-storage provider selection and separate deployment credentials.
- [ ] Signed upload/download intents, size/MIME/checksum validation and ownership verification.
- [ ] Malware scanning, thumbnail generation, transcoding, CDN and retention jobs.
- [ ] Media/document/link galleries, search, sharing and revocation.
- [ ] Status/stories, expiry enforcement, audience controls, moderation and abuse reporting.
- [ ] Export/delete and media lifecycle tests.

Current state: Media module stores owner-scoped metadata only. Binary upload, storage and scanning are not implemented.

## Phase 4 — Voice and video calls

- [ ] Authenticated, short-lived WebRTC signaling and call lifecycle.
- [ ] STUN/TURN provider and regional connectivity deployment.
- [ ] Audio/video permissions, device selection, switching, reconnect and failure UX.
- [ ] Ringing, call invitations, missed-call state and notifications.
- [ ] Blocking, reporting, abuse controls and recording consent.
- [ ] Network quality, concurrency, regional latency and mobile data tests.

Current state: no independent live calling service is implemented.

## Phase 5 — Work and shared workspace

### Delivered foundation
- [x] Owner-scoped workspace, project, task and calendar-event APIs.
- [x] Per-user dashboard preferences for layout, visible pillars and contextual panels.
- [x] Initial Work UI for workspace/project/task/event records.

### Still required
- [ ] Cross-user workspace membership, invitations, roles and permission inheritance.
- [ ] Shared documents, notes, files, comments and collaborative editing.
- [ ] Multi-tab workspace, drag/drop configurable cards and responsive dashboard layout.
- [ ] Contextual panels, shared search and activity feed.
- [ ] Calendar recurrence, timezone correctness, reminders and external calendar integrations.
- [ ] Assignment, notifications, mentions, task dependencies, workflow automation and audit history.
- [ ] Collaboration concurrency, conflict handling and offline drafts.

Current state: personal owner-scoped records and dashboard preferences only; shared collaboration is not complete.

## Phase 6 — Commerce

### Delivered foundation
- [x] Owner-scoped business profiles and product catalogue records.
- [x] Integer minor-unit prices and ISO currency validation.
- [x] Server-calculated draft order snapshots with currency consistency checks.

### Still required
- [ ] Separate merchant, buyer and staff identities/roles; buyer-to-seller order ownership.
- [ ] Public storefronts, discovery, catalogue variants, images, inventory and stock reservations.
- [ ] Cart, checkout, shipping, tax, discounts, fulfilment, returns and refunds.
- [ ] Merchant onboarding, verification, customer support and dispute workflows.
- [ ] Payment-provider adapter, signed webhooks, idempotency and settlement reconciliation.
- [ ] Country-specific consumer, tax, privacy and financial compliance review.

Current state: foundational owner-scoped records and draft orders only. No checkout or payment collection is active.

## Phase 7 — Finance

### Delivered foundation
- [x] Immutable bookkeeping-style records with integer minor-unit amount and ISO currency validation.

### Still required
- [ ] Double-entry ledger, authoritative balances and transaction state machine.
- [ ] Wallet custody or payment provider selection and approval.
- [ ] Payment intents, transfers, payout, refunds, chargebacks and reconciliation.
- [ ] Receipts, statements, audit trail and dispute evidence.
- [ ] KYC/AML, fraud monitoring, sanctions checks and country-by-country licensing.
- [ ] Provider webhooks, signature verification, replay prevention and settlement verification.
- [ ] Penetration tests, reconciliation drills and financial control review.

Current state: bookkeeping records only. Not a wallet, bank account, payment rail or regulated financial service.

## Phase 8 — AI

### Delivered foundation
- [x] Explicit per-user AI consent.
- [x] Configurable OpenAI-compatible provider boundary.
- [x] Provider absence fails closed; opt-out deletes stored AI conversation records.

### Still required
- [ ] Streaming responses, provider failover and per-user quotas.
- [ ] Permission-aware retrieval with citations and source visibility.
- [ ] Summarization, drafting, search and workflow actions with user confirmation.
- [ ] Prompt-injection defenses, tool authorization and sandboxing.
- [ ] Model governance, evaluation, moderation, retention and provider privacy review.
- [ ] No private-data model training without explicit consent and clear product controls.

Current state: opt-in chat adapter only; no retrieval, tools, citations or full governance.

## Phase 9 — Security, privacy, reliability and global readiness

- [x] Same-origin mutation checks.
- [x] Persistent login/registration/bootstrap throttling.
- [x] Production response security headers configured in Vercel.
- [x] Owner/tenant-scoped records and module field allowlists.
- [x] Immutable order/finance API records.
- [ ] OWASP ASVS 5.0 verification and OWASP API Security Top 10 coverage.
- [ ] Independent external penetration test and remediation.
- [ ] Encryption/key management review and E2EE implementation.
- [ ] Data export, deletion, retention, legal hold and consent workflows.
- [ ] Backup/restore drills, regional recovery and business continuity.
- [ ] Structured logs, metrics, traces, privacy-safe diagnostics and alerting.
- [ ] Incident response, abuse handling, security notifications and vulnerability disclosure.
- [ ] Load, chaos, failover and regional latency tests.
- [ ] Localization, accessibility, time zones, low-bandwidth/offline resilience and data-cost controls.

## Phase 10 — PTU compatibility and MAC governance

- [x] Confirm PTU remains on its own repository, identity, integrations and database.
- [x] Draft PTU security changes for membership checks, broadcast role restrictions, group unread count, demo tester policy and inbound SMS callback authentication.
- [x] Add PTU unit tests for MAC tester policy and demo-password visibility.
- [x] Add PTU persistent per-holder throttles for thread starts, message sends and broadcasts.
- [x] Add a dedicated PTU validation workflow definition on the draft PR branch.
- [x] Execute PTU tests, syntax checks and Vite build on GitHub Actions: 7 tests passed, all four server syntax checks passed, and Vite production build passed on PTU PR head `a660881be0a9fdeaab8ed6ccb5e58bf689c1a77e`.
- [ ] Verify Africa's Talking exact callback payload, retry behavior, secret handling and live sandbox.
- [ ] Add broadcast quotas, recipient consent/opt-out and delivery audit.
- [ ] Review all PTU route authorization and data migrations.
- [ ] Confirm PTU MAC tester policy blocks only PTU seeded/demo accounts and never locks out the MAC operator or real accounts.
- [ ] Validate existing PTU routes, Higher/ODEI OS links, UID/email/SMS, MAC controls and existing integrations.
- [ ] Complete PTU staging smoke tests before merging or deployment.

## Phase 11 — Dual-deployment release and operations

- [ ] Verify independent Vercel project, domain, deployment ownership and environment variables.
- [ ] Verify PTU Vercel project and production environment without exposing secrets.
- [ ] Verify distinct MongoDB Atlas projects/databases and least-privilege users.
- [ ] Separate session secrets, bootstrap secrets, provider credentials and storage buckets.
- [ ] Contract tests for explicitly approved signed cross-product integrations only.
- [ ] Separate preview, staging, production promotion and rollback workflows.
- [ ] Confirm deployment to one repo cannot trigger the other Vercel project.
- [ ] Health, authentication, tester-policy, messaging and isolation smoke tests on both deployments.
- [ ] Backup restore and rollback rehearsal for both deployments.
- [ ] Monitor each deployment independently with clear SLOs and incident ownership.

## Release gates

No production promotion until the current commit passes CI, security review and staging acceptance; all required secrets and providers are configured in the correct deployment; external webhook behavior is verified; backup restore and rollback are rehearsed; accessibility and performance checks are recorded; data migrations are reversible; monitoring and incident response are ready; and the actual deployed application passes smoke tests.

Do not merge a draft PR, enable public financial functionality, expose live demo passwords, or claim a provider-dependent feature is live without the corresponding verified acceptance evidence.
