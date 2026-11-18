# SsibuChat Implementation Roadmap

This roadmap is the complete delivery register. A phase is not complete because a screen exists; it is complete only when its acceptance checks pass.

## Phase 0 — Baseline, governance and safety
- [x] Confirm A+B+C: PTU upgrade, independent build, both deployments maintained.
- [x] Establish PTU MAC vs independent admin tester-control boundary.
- [x] Inspect PTU source and record known product/security gaps.
- [ ] Verify live Vercel projects, domains, env names and deployment ownership.
- [ ] Verify MongoDB Atlas projects, users, network rules, backups and indexes.
- [ ] Establish threat model, data inventory, SLOs, incident owner and release checklist.

## Phase 1 — Independent foundation
- [x] Independent Vite application, Mongo connection utility, API health endpoint and Vercel configuration (runtime deployment not yet configured).
- [x] Independent account registration, password hashing, login/logout and opaque server-side sessions; one-time admin bootstrap endpoint.\n- [ ] Account recovery, email verification, MFA and device/session management.
- [x] Independent tester policy and admin controls; disabled by default and enforced server-side, with session revocation when switched off. No PTU MAC dependency.
- [ ] Tenant/membership model, schema migrations, audit events and rate limiting.
- [x] GitHub Actions CI for unit tests and production build.\n- [ ] Add lint, typecheck, integration/E2E tests and dependency/security remediation.
- [ ] Accessibility and responsive design baseline (WCAG 2.2 AA target).

## Phase 2 — Secure Connect core
- [ ] Direct and group messaging with object-level authorization.
- [ ] Idempotent message writes and per-recipient delivery/read receipts.
- [ ] Reliable group fan-out, bounded retries and dead-letter handling.
- [ ] Push-based realtime with cursor sync and polling fallback.
- [ ] Contacts, username discovery, privacy, block/report and moderation.
- [ ] Provider-authenticated inbound SMS with replay protection and idempotency.
- [ ] Email/SMS adapter configuration and consent/opt-out.

## Phase 3 — Media and status
- [ ] Signed object-storage uploads and downloads.
- [ ] MIME/size/checksum validation, malware scanning and thumbnail/transcode jobs.
- [ ] Media/docs/links galleries and searchable metadata.
- [ ] Status/stories, expiry, audience controls, moderation and retention.
- [ ] Export/delete and media lifecycle tests.

## Phase 4 — Calls
- [ ] Authenticated WebRTC signaling and call lifecycle.
- [ ] STUN/TURN deployment and regional connectivity testing.
- [ ] Audio/video permission UX, device switching, reconnect and failure states.
- [ ] Call abuse controls, blocking, reporting and privacy settings.
- [ ] Load and network-quality tests.

## Phase 5 — Work
- [ ] Workspace, task, calendar, note and file domains.
- [ ] Multi-tab workspace and configurable multi-card dashboard.
- [ ] Contextual side panels, shared search and activity feed.
- [ ] Collaboration roles and notification preferences.

## Phase 6 — Commerce and Finance
- [ ] Business profiles and catalogues.
- [ ] Orders, customer conversations and merchant tools.
- [ ] Payment intent state machine and provider adapters.
- [ ] Idempotent webhooks, reconciliation, receipts and dispute trail.
- [ ] Country-by-country licensing/compliance review before financial launch.

## Phase 7 — AI
- [ ] Opt-in assistant and model-provider abstraction.
- [ ] Permission-aware retrieval and source citations.
- [ ] Summaries, drafting and workflow actions with user confirmation.
- [ ] Prompt-injection defenses, tenant isolation, privacy and usage limits.

## Phase 8 — Security, scale and global readiness
- [ ] OWASP ASVS 5.0 verification and OWASP API Top 10 coverage.
- [ ] E2EE protocol design and independent security review before rollout.
- [ ] Data retention, deletion, portability and backup restore drills.
- [ ] Observability, alerting, incident response and audit exports.
- [ ] Load, chaos, regional latency and accessibility testing.
- [ ] Localization, time zones, low-bandwidth and offline resilience.

## Phase 9 — PTU parity and dual-deployment operations
- [ ] Apply targeted PTU security fixes without replacing PTU auth/integrations. A draft, unmerged PTU PR currently contains the first authorization and MAC tester-policy changes.
- [ ] Enforce MAC tester policy for PTU-hosted tester accounts only.
- [ ] Verify PTU routes, Higher/ODEI OS links, UID/email/SMS and MAC controls.
- [ ] Keep independent admin/tester policy isolated from PTU MAC.
- [ ] Contract tests for any signed cross-product integration.
- [ ] Release, rollback and migration runbooks for both deployments.

## Release gates

**No production launch** until: tests pass; secrets are in the correct deployment; webhook verification is proven with the provider; backup restore is rehearsed; security/accessibility checks are documented; data migrations are reversible; monitoring and rollback are ready; and smoke tests pass on the actual deployment. Never merge or deploy PTU changes as a side effect of independent product work.
