# SsibuChat Implementation Status

**Updated:** 2026-11-18 14:39 UTC\n**Last application/config commit validated by CI:** `12b91a37483d3ca01d2c05a9a2acd0233b29f865`  
**Independent repository:** [ssibuchat/ssibuchat](https://github.com/ssibuchat/ssibuchat)  
**PTU security work:** [Draft PR #1](https://github.com/payteamuniversity/payteam/pull/1)

## Delivered in the independent repository

- Product audit, architecture, phased roadmap and deployment runbook.
- React/Vite super-app shell with six product pillars: Connect, Work, Commerce, Finance, Media and AI.
- MongoDB Atlas connection utility and initial indexes.
- Independent account registration, password hashing, login/logout and opaque server-side sessions.
- One-time bootstrap endpoint for the first independent administrator.
- Independent tester account creation and enable/disable controls; tester access defaults to disabled, is enforced server-side and disabling it revokes tester sessions.
- Initial Connect API for thread listing and idempotent message submission (not yet a complete chat product).
- Vercel configuration and GitHub Actions CI.
- Automated security primitive tests.

## Validation observed

- GitHub Actions run on commit `1220a52484bbdab7cb1c4a0c35faac9d0ee46774`: **passed**.
- Node 20 dependency install: passed.
- Unit tests: 4 passed, 0 failed.
- Vite production build: passed.
- npm install reported **4 high-severity dependency advisories**. These must be identified and remediated before production release; the latest CI run includes a dependency audit summary step to expose the affected packages.

## PTU-hosted implementation

A draft PR adds conversation-membership authorization, group unread-count correction, role restrictions for broadcast, authenticated peer lookup, PTU MAC enforcement of the existing `demoDataEnabled` tester switch, MAC-controlled public demo password hints, and removal of plaintext password fields from newly seeded account documents.

The PR is **not merged**. GitHub currently reports the draft PR as mergeable/clean, but no PTU build, test or provider verification has been run. PTU `main` and production have not been changed. No runtime test or PTU build has been performed.

## Not yet delivered

- Complete Connect: create/direct/group threads, history, receipts, reliable fan-out, push realtime, SMS webhook signature verification, media upload pipeline, channels and communities.
- WebRTC audio/video and TURN infrastructure.
- Work, Commerce, Finance, Media and AI domain services beyond the product shell and architecture.
- E2EE protocol and audited key management.
- Distributed rate limiting, CSRF tokens, email verification, recovery, MFA, moderation, privacy export/deletion and retention jobs.
- Operational configuration: independent Vercel project, Atlas production database/user/network policy, object storage, provider credentials, backups and monitoring.
- Staging, load, accessibility, security and production smoke tests.

## Production gate

The independent app is a tested buildable foundation, not a production-ready super-app. Do not announce production availability or enable public signups until dependency advisories are resolved, the deployment environment is configured, end-to-end/security testing passes and backup/rollback procedures are rehearsed.


## Additional independent implementation (foundation branch)

Branch: `implementation/superapp-foundations`.

- Added fail-closed Origin/Referer checks to the independent application branch; missing and opaque origin metadata are rejected. The original control-character sanitizer is preserved.
- Added owner/tenant-scoped module APIs for Workspaces, Projects, Tasks, Events, Businesses, Products, Orders, Finance records and Media metadata.
- Added draft order snapshots with server-calculated line totals and currency consistency checks.
- Added immutable financial record policy and integer minor-unit validation.
- Added per-user workspace dashboard preferences.
- Added explicit AI consent and a configurable OpenAI-compatible chat adapter. No AI request is sent until consent is enabled and provider secrets/model are configured.
- Added collection indexes and validation tests for field allowlists, task enums, money values and control-character stripping.
- Added security, architecture and operations documentation.

This branch is under review and must pass the repository's complete CI workflow and security review before merge. Provider-dependent capabilities and the production gates listed above remain incomplete.


## Follow-on hardening and interface work

- Added persistent MongoDB-backed rate limits for admin bootstrap, registration and login.
- Added responsive authenticated pillar workspaces for Work, Commerce, Finance, Media and AI.
- Added record identifiers to the UI so owner-scoped records can be linked between projects, products and orders.
- Latest fully validated CI head before the final UI identifier adjustment: `bfc81f4d5279aedc41b240d0dab5b2842432bba0`. GitHub Actions: 14 tests passed, Vite build passed, production dependency audit found 0 vulnerabilities.
- Full npm audit still reports 4 high-severity findings in development/build dependencies through picomatch <=4.0.7. The published upstream advisory currently has no patched version; these are not production runtime dependencies. Recheck before each release.
- The latest UI identifier adjustment is committed separately and its CI run must complete before merge.


## Connect retry reliability correction
- Message idempotency conflicts now reject reuse of a key for a different thread/body.
- A retry after a partial message write repairs thread summary/count and upserts the corresponding outbox event instead of returning early and silently losing the event.
- Added a unique outbox identity index to prevent duplicate accepted-message events.
- The new retry/outbox correction is committed after the last completed CI run and is awaiting its own validation.


## Latest follow-on security and UX changes
- Added rate limits to module writes, workspace preference changes, AI consent/chat, thread creation and message sends.
- Added comma-separated participant entry for creating group conversations in the Connect UI.
- Added production CSP, HSTS, frame, referrer, permissions and cross-origin opener headers in Vercel configuration.
- These latest rate-limit and header/UI changes require the current PR head's CI and preview checks before approval.


## Current CI confirmation
- Current reviewed branch head: `31e165c042ad895b5299e83b76180bd885565b8b`.
- GitHub Actions `verify`: 14 tests passed, 0 failed; Vite production build passed; production dependency audit passed with zero production vulnerabilities.
- The full audit still reports four high-severity development-toolchain advisories through picomatch <=4.0.7. The advisory has no confirmed patched version in the current upstream record; production dependency audit is clean, but the development-toolchain finding remains tracked.
- Vercel Preview Comments check passed with zero unresolved feedback. Preview URL exists; authenticated end-to-end verification against a configured MongoDB and provider environment remains outstanding.


## PTU branch validation
- PTU security PR head `a660881be0a9fdeaab8ed6ccb5e58bf689c1a77e` passed GitHub Actions run [44330021713](https://github.com/payteamuniversity/payteam/actions/runs/44330021713): 7 tests passed, all four server syntax checks passed, `npm ci` passed and Vite production build passed.
- PTU branch remains a draft. Africa's Talking callback sandbox verification, broadcast consent/opt-out, staging smoke tests and operator acceptance remain release gates.
- PTU main and production remain unchanged.


## Current independent validation (latest code)
- Current validated code head: `bdc8bdae3b19749e03199e410fbc5094a10a921f`.
- GitHub Actions run [44330325713](https://github.com/ssibuchat/ssibuchat/actions/runs/44330325713) passed: 15 tests, 0 failures; Vite production build passed; production dependency audit found zero vulnerabilities.
- Same-origin enforcement now compares both scheme and host, with regression coverage for HTTPS downgrade rejection.
- The full development dependency audit continues to report four high-severity picomatch-related findings; production dependencies remain clean. Upstream currently lists picomatch versions through 4.0.7 as affected without a confirmed patched release.

- PTU rate limiting was extracted into a testable MongoDB-backed helper; the new tests cover threshold enforcement, actor hashing and invalid configuration.


## Phase 1 execution update — 2026-11-18

- Added independent TOTP MFA enrollment, confirmation, login challenge, disable and session-revocation paths.
- MFA TOTP secrets use AES-256-GCM with a separate SSIBUCHAT_MFA_ENCRYPTION_KEY; recovery codes are stored as keyed hashes and consumed once.
- Added three focused MFA tests, including the RFC 6238 SHA-1 reference vector and authenticated-encryption tamper rejection.
- Committed lockfile v3 and changed CI from npm install to npm ci. Latest lockfile-driven GitHub Actions run [44353196457](https://github.com/ssibuchat/ssibuchat/actions/runs/44353196457) passed: 19 tests, 0 failures; production audit found 0 vulnerabilities; Vite build passed.
- Full dependency audit still reports four high-severity development-toolchain findings rooted in picomatch 4.0.7. The published advisory currently lists no patched release; no unsafe override or audit suppression was applied. Production dependency audit remains clean.
- MFA API/database integration tests, account-facing MFA setup UI, email verification, recovery workflow, and broader identity/tenant governance remain open acceptance work.
- PTU MAC authority and independent tester-policy boundary remain unchanged. No merge to the default branch and no production deployment occurred.


## Phase 1 identity completion increment — 2026-11-18

- Added account-facing authenticator setup and confirmation, manual secret/provisioning URI presentation, one-time recovery-code display, MFA disable, and login challenge verification.
- Added TOTP replay prevention across distinct login challenges by atomically advancing the last accepted time-step.
- Added authenticated session inventory and a revoke-other-sessions control; the current session remains active.
- Added route-level MFA integration tests with a deterministic in-memory database adapter: successful login challenge, single-use challenge, one-time recovery-code consumption, invalid code rejection and TOTP replay rejection.
- Latest CI run [44354086821](https://github.com/ssibuchat/ssibuchat/actions/runs/44354086821) passed: npm ci; 23 tests, 0 failures; production dependency audit 0 vulnerabilities; Vite production build passed.
- Remaining Phase 1 acceptance: run the MFA/session flows against a real staging MongoDB/Vercel environment; email verification, password recovery, passkeys, tenant membership/roles, versioned migrations, admin audit UI and security notifications.


## Phase 2 Connect execution increment — 2026-11-18

- New group threads record a creator/admin; added server-authorized member listing, member add/remove, admin promotion and group-title changes. Existing groups fall back to their creator as the initial admin.
- Added per-recipient message receipt records with idempotent upserts. Reading thread history advances accepted receipts to delivered; an explicit read endpoint advances receipts to read; senders can inspect per-recipient receipt state.
- Added indexes for unique tenant/message/recipient receipt identity and recipient/status queries.
- Added Connect API integration tests for accepted → delivered → read receipt progression, sender receipt inspection, group admin authorization, member addition, admin promotion and member removal.
- GitHub Actions run [44354724227](https://github.com/ssibuchat/ssibuchat/actions/runs/44354724227) passed: npm ci; 25 tests, 0 failures; production dependency audit 0 vulnerabilities; Vite build passed.
- Still outstanding in Connect: durable outbox fan-out worker/retry/dead-letter processing, provider sent/failed delivery states, push realtime/presence, notifications, moderation/report/block, attachments/scanning, search/edit/delete/reactions and E2EE.


## Phase 2 Connect outbox worker increment — 2026-11-18

- Added a lease-based outbox dispatcher that atomically claims events, fans message-accepted events into idempotent per-recipient delivery jobs, marks processed events, retries failures with exponential backoff, and dead-letters after ten attempts.
- Added unique delivery-job and pending-outbox indexes.
- Added an authenticated Vercel cron handler requiring CRON_SECRET and a bounded function configuration.
- Added tests for per-recipient fan-out, event completion, retry/backoff, dead-lettering and cron bearer-secret/method validation.
- Latest GitHub Actions run [44355344563](https://github.com/ssibuchat/ssibuchat/actions/runs/44355344563) passed: npm ci; 28 tests, 0 failures; production dependency audit 0 vulnerabilities; Vite build passed.
- Scheduler activation is intentionally not configured yet: Vercel Hobby supports daily cron cadence while Pro/Enterprise support per-minute execution; the actual project plan and CRON_SECRET must be verified before choosing a schedule. The endpoint and worker code are implemented, but automated scheduled delivery is not yet live.
- Delivery jobs are queued only. No SMS/push/email provider dispatch or sent/failed delivery state is claimed.


## Phase 2 Connect group-invite increment — 2026-11-18

- Added secure 256-bit group invite tokens; only HMAC token hashes are persisted.
- Invites have bounded expiry (1–168 hours), bounded uses (1–100), optional admin approval, and admin revocation/listing.
- Added join-request submission, pending request listing and admin approve/deny controls. Approved joins atomically consume a use and add the user to the group.
- Added TTL, unique pending-request and listing indexes.
- Added integration coverage for invite creation, approval-required join, pending request visibility and admin approval/member addition.
- GitHub Actions run [44356028441](https://github.com/ssibuchat/ssibuchat/actions/runs/44356028441) passed: npm ci; 29 tests, 0 failures; production audit 0 vulnerabilities; Vite build passed.
- Group fine-grained member-role policy and history visibility remain pending. Vercel preview build currently reports an account build-rate-limit failure; no new preview or production deployment was created.


## Phase 2 Connect moderation and message controls — 2026-11-18

- Added per-user direct-conversation block/unblock list; both direct thread creation and direct message sending reject blocked pairs.
- Added rate-limited reports for user, message and group targets; reports are visible to tenant admins and can be moved to reviewing/resolved/dismissed.
- Added sender-only message editing, sender/group-admin soft deletion, allowlisted emoji reactions with per-user uniqueness, and participant-scoped message search with bounded query length/results.
- Added indexes for block lists, moderation queues and message reactions.
- Added API tests for block enforcement, report submission/admin review, edit/delete, reaction add/remove and participant-scoped search.
- Latest CI run [44357042708](https://github.com/ssibuchat/ssibuchat/actions/runs/44357042708) passed: npm ci; 31 tests, 0 failures; production dependency audit 0 vulnerabilities; Vite build passed.
- Group-wide block behavior, moderation actions/appeals, binary attachments and malware scanning remain open.


## Phase 1 schema/tenant foundation and Phase 3 Work increment — 2026-11-18

- Added a leased, idempotent schema migration registry and tenant membership backfill. Existing users receive a tenantId/schemaVersion and membership record; existing workspace owners receive workspace owner memberships. New standard/admin/tester accounts create memberships at registration.
- Added shared workspace invitations bound to an existing intended user, with hashed single-use token, seven-day expiry and editor/viewer roles.
- Added workspace member listing, owner-controlled role changes/removal, shared documents, optimistic version checks, append-only revision snapshots and workspace activity feed.
- Viewers can read shared documents/history/activity; editors can create/update documents; owners manage membership and invitations.
- Added indexes for schema migrations, workspace memberships/invites/documents/revisions/activity.
- Added tests for migration idempotency/backfill, invitation acceptance, role enforcement, stale-version conflict, revision history and activity events.
- Latest GitHub Actions run [44358121172](https://github.com/ssibuchat/ssibuchat/actions/runs/44358121172) passed: npm ci; 34 tests, 0 failures; production dependency audit 0 vulnerabilities; Vite build passed.
- Remaining Work acceptance: real-time co-editing/CRDT, comments, granular document permissions, and shared project/task/calendar CRUD. Current projects/tasks/calendar modules remain owner-scoped.


## Phase 1 email recovery and Work UI increment — 2026-11-18

- Added a Resend transactional email adapter; delivery requires RESEND_API_KEY, SSIBUCHAT_EMAIL_FROM and SSIBUCHAT_APP_URL in the independent deployment.
- Added authenticated email verification requests and public single-use confirmation, plus generic password-reset requests and single-use password-reset confirmation. Tokens are stored as hashes, expire, and are consumed once; password reset invalidates every active session.
- New standard/admin accounts start with emailVerified=false. Auth/session responses expose verification status. Security settings can request verification; email links auto-confirm. Sign-in UI supports password recovery request and reset-link completion.
- Added token TTL/unique indexes and integration tests covering verification, token replay rejection, reset, password hash update and session invalidation using a mocked email provider.
- Added shared project/task/calendar membership checks and activity events; shared workspace UI now supports invitation acceptance, owner role changes/removal, shared documents, revisions and activity.
- Latest CI run [44359823249](https://github.com/ssibuchat/ssibuchat/actions/runs/44359823249) passed: npm ci; 37 tests, 0 failures; production audit 0 vulnerabilities; Vite build passed.
- External acceptance remains: configure and verify the actual Resend sender domain and credentials in staging/production; run real email delivery and account recovery smoke tests. Passkeys, email change and security notifications remain pending.


## Finance double-entry ledger increment — 2026-11-18

- Added account catalog with asset/liability/equity/income/expense types and per-account ISO currency.
- Added balanced journal posting in integer minor units; every line must be a positive debit or credit, each journal must balance, and account ownership/currency is verified.
- Journal postings are immutable. Idempotency keys are bound to a payload hash; reusing a key with different content returns conflict.
- Added trial-balance aggregation with normal-balance sign by account type and immutable reversal journals.
- Added indexes for account codes, journal idempotency and one-reversal-per-original.
- Added Finance UI for account creation, balanced two-line journal posting, trial balance and reversals.
- Tests cover unbalanced rejection, balanced posting, idempotent replay, conflicting key reuse, trial balance, reversal and duplicate reversal rejection.
- Latest GitHub Actions run [44360462995](https://github.com/ssibuchat/ssibuchat/actions/runs/44360462995) passed: npm ci; 38 tests, 0 failures; production dependency audit 0 vulnerabilities; Vite production build passed.
- Payment/wallet provider integration, external settlement/reconciliation, KYC/AML and licensing remain unimplemented pending provider and jurisdiction approvals.


## Phase 1 password security increment — 2026-11-18

- Added authenticated password change requiring the current password and a 12–128 character new password; reuse of the current password is rejected.
- Password updates use a conditional write to prevent a concurrent change from silently overwriting a newer credential.
- Successful changes revoke every active session, clear the current session cookie, and write an account-security audit event.
- A security notice is sent to the verified account email when the transactional email provider is configured. Notification delivery failure does not roll back the credential change and is surfaced in the API response.
- Added account-security UI and integration tests for incorrect current password, short/reused passwords, credential update, session revocation, audit event and security email.
- GitHub Actions run [44360720899](https://github.com/ssibuchat/ssibuchat/actions/runs/44360720899) passed on the current branch head: `npm ci`, `npm test`, production dependency audit and Vite production build all succeeded.
- Phase 1 remains open: passkeys, email-change workflow, complete security notifications for all security events, admin audit interface, real staging acceptance for MongoDB/email/MFA, and browser-level identity recovery verification. Do not treat this increment as Phase 1 completion.


## Phase 1 verified email change increment — 2026-11-18

- Added authenticated, rate-limited email-change requests requiring the current password.
- The proposed address is checked for conflicts and remains unchanged until a one-hour, single-use confirmation token sent to that address is redeemed.
- Only the token hash is persisted; confirmation marks the new address verified, records an audit event and sends a security notice to the previous address when email delivery is configured.
- Added account security UI for requesting and completing the email change, plus integration coverage for current-password enforcement, confirmation, replay rejection and prior-address notification.
- CI evidence for this increment is pending; the previous successful CI run does not cover these latest commits.


## Latest Phase 1 / Commerce CI triage — 2026-11-18

- The first CI run covering email-change implementation, [44361231314](https://github.com/ssibuchat/ssibuchat/actions/runs/44361231314), failed at `npm test`: 40 passed and 2 failed.
- Failure 1 was in the email-change test's confirmation-link token extraction (the test regex captured beyond the token); corrected to stop at whitespace.
- Failure 2 was a stale Commerce product projection assertion after inventory defaults (`trackInventory: false`, `stockQuantity: 0`) were added; updated the assertion to match the intended server-side defaults.
- Both corrections are committed. A new CI result for the corrected head has not yet been observed; email-change acceptance remains unverified until the full workflow passes.


## Phase 1 / Commerce verification follow-up — 2026-11-18

- CI run [44361477089](https://github.com/ssibuchat/ssibuchat/actions/runs/44361477089) executed 42 tests: 41 passed, 1 failed. The new email-change end-to-end integration test passed, including confirmation and previous-address notification.
- The remaining failure was the Commerce projection test: the previous correction added inventory defaults to the input fixture rather than asserting the server-generated defaults in the expected projection. The assertion is now corrected so the input omits inventory fields and the expected result includes `trackInventory: false` and `stockQuantity: 0`.
- Correction commit: `0878ae3528160c88f2850e51a6a2c6765dc0a651`. A full CI run for this exact head is still pending; no passing status is claimed for the corrected head.


## Corrected Phase 1 / Commerce CI acceptance — 2026-11-18

- Corrected branch head `198a52b3399e1ddcda01ef7b7693359136a96a29` passed GitHub Actions [run 44361648396](https://github.com/ssibuchat/ssibuchat/actions/runs/44361648396).
- `npm ci`: passed.
- `npm test`: **42 passed, 0 failed**, including the verified email-change workflow and product inventory-default projection.
- Production dependency audit: passed with zero production dependency vulnerabilities.
- Dependency advisory report step: completed; the development-only picomatch advisory remains documented and unsuppressed.
- Vite production build: passed.
- This closes the code-and-CI portion of this email-change increment. It does not close all Phase 1 acceptance: passkeys, full security notifications, admin audit UI, staging/provider verification and browser E2E remain open.


## Phase 1 administrative audit interface increment — 2026-11-18

- Added an independent-admin-only `GET /api/admin/audit` endpoint with a bounded 1–100 result limit, newest-first ordering and strict tenant scoping.
- API serialization allowlists event ID, actor ID, action, target and timestamp; it does not return arbitrary audit documents or credentials.
- Added an admin UI for viewing recent audit events and tests for tenant isolation, field allowlisting, result bounds and non-admin denial.
- CI for this new audit-interface increment is pending; the earlier 42/42 pass does not cover these latest changes.


## Phase 1 administrative audit CI acceptance — 2026-11-18

- GitHub Actions [run 44362043483](https://github.com/ssibuchat/ssibuchat/actions/runs/44362043483) passed on the admin-audit implementation head.
- `npm ci`: passed.
- `npm test`: **44 passed, 0 failed**, including tenant-scoped audit API authorization, bounded result limits and field allowlisting.
- Production dependency audit: passed with zero production dependency vulnerabilities.
- Vite production build: passed.
- This closes the code-and-CI portion of the bounded independent-admin audit feed. It does not replace the broader platform governance, immutable audit retention, cross-tenant oversight, export or deletion acceptance criteria.


## Phase 1 security notification CI acceptance — 2026-11-18

- GitHub Actions [run 44362314802](https://github.com/ssibuchat/ssibuchat/actions/runs/44362314802) passed on the security-notification implementation head.
- `npm ci`: passed.
- `npm test`: **44 passed, 0 failed**, including password-reset security notification assertions and admin audit interface tests.
- Production dependency audit: passed with zero production dependency vulnerabilities.
- Vite production build: passed.
- Password reset and MFA enable/disable now attempt post-event security notices to verified email addresses; failures are non-fatal and the event remains audited. Device-aware sign-in alerts and notification preferences remain open.
