# SsibuChat — Global Product Audit

**Scope:** PTU-hosted SsibuChat source baseline and independent product target.  
**Audit mode:** repository/source inspection. No production runtime, Vercel environment, Atlas configuration, provider credentials, live traffic or backups were inspected. Treat operational state as unverified until measured.

## 1. Product position

SsibuChat is to become an independent, global communication and productivity super-app—not a PTU-only chat module and not a rebrand of Campus Chat, ODELPay, AssessmentVerse or School Agent. PTU-hosted SsibuChat remains an integrated institutional surface while the independent product becomes the primary product.

## 2. Existing PTU baseline (source-confirmed)

The PTU repository contains a React/Vite application, a MongoDB-backed API, PTU session authentication, and a mounted SsibuChat surface at `/SsibuChat` with legacy aliases. Existing UI areas include chats, calls, status, channels, communities, business tools, lists, media, profile and settings. Delivery rails include in-app messaging, user identifiers, email and Africa's Talking SMS when configured.

Existing collections include threads, messages, contacts, usernames, profiles, status, channels, communities, calls, lists, quick replies, media and presence. PTU integration is valuable and must not be broken.

## 3. Existing gaps and risks (source-confirmed unless marked otherwise)

| Area | Current source finding | Required outcome |
|---|---|---|
| Authorization | Prior source review found thread-send, thread-update and presence membership checks missing in the original baseline. A draft security PR adds these checks; it is not merged. | Enforce object-level authorization on every read/write, including attachments, receipts, calls and group administration. |
| Inbound SMS | The original webhook path accepted unauthenticated POST requests; no provider signature/shared-secret verification was found in the inspected path. | Verify provider-supported authenticity, replay protection, rate limits and delivery idempotency before processing. |
| Demo/test access | PTU MAC already has Demo Data Management flags: `demoDataEnabled`, `publishDemoPasswords`, `ssibuChatShowDemoMedia`. Seed accounts are created/upserted by `ensureTeamAuthSeed`. The inspected authentication path did not enforce the MAC demo-access flag; public password hints also used an environment toggle rather than the MAC setting. | Preserve demo accounts. Enforce PTU MAC policy server-side for PTU test accounts. Disabling tester access must not disable real accounts or delete test data. |
| Group delivery | The original group unread update incremented only one peer. The draft security PR changes this to every non-sender participant. | Per-recipient delivery state, retries, receipts, idempotency and fan-out monitoring. |
| Attachments | Existing chat attachment path records metadata rather than reliably uploading original bytes. | Signed uploads to object storage, malware scanning, MIME/size checks, access-controlled downloads and lifecycle rules. |
| Realtime | Inbox refresh uses polling (approximately every 3.5 seconds in inspected UI). | Push-based event delivery with reconnect, backoff and polling fallback. |
| Calls | Existing call objects are records/notifications, not complete WebRTC audio/video sessions. | Signaling, TURN/STUN, permissions, ringing, reconnect, call state and abuse controls. |
| Encryption | Message bodies were readable in MongoDB; no end-to-end encryption was found. | TLS in transit, encryption at rest, managed key rotation, and a reviewed E2EE design for supported conversations. |
| Status | Existing status is primarily text with a 24-hour display window. | Secure media status, audience controls, expiry enforcement and reporting. |
| Channels/communities | Seeded directory and follow/join states exist; full publishing and community conversation behavior is incomplete. | Roles, moderation, posting, membership, discovery and notification flows. |
| Broadcast | Existing broadcast permission needed stronger role limits and operational controls. | Consent, opt-out, quotas, abuse prevention, audit trail and delivery analytics. |
| App lock | Client-side localStorage PIN is a convenience feature, not a security boundary. | Server-side session controls, re-authentication and device/session management. |
| Demo credentials | Hard-coded demo credentials exist in source. Whether any are exposed in the current production environment was not verified. | MAC-controlled access and credential disclosure; never infer live exposure from source alone. |
| Performance | MongoDB indexes and load behavior were not fully audited. | Query/index review, pagination, load tests and operational SLOs. |
| Testing | The inspected PTU tree had no relevant automated tests or GitHub Actions workflows at the time of review. | Unit, integration, security, accessibility, E2E and deployment checks. |

## 4. Global product requirements

### Connect
- Direct, group and multi-device messaging.
- Usernames, contacts, search, blocking, reporting and privacy controls.
- Message states: accepted, sent, delivered, read, failed and retried.
- Typing/presence controls and offline delivery.
- Channels, communities, moderation, broadcast consent and notifications.
- Voice/video calls with WebRTC and signaling.
- SMS/email gateways as optional, institution/provider-configured rails.

### Work
- Personal and team workspaces.
- Tasks, projects, calendar, notes, file spaces and shared lists.
- Search across authorized content.
- Contextual panels and multi-tab workspace.
- Notifications and activity history.

### Commerce
- Business profiles, catalogues, product/service listings, orders and customer conversations.
- Merchant roles, inventory/order state and customer support.
- Payment-provider adapters; no claim of regulated financial capability without the required licences and provider approval.

### Finance
- Wallet/account views, transaction history, receipts, reconciliation and payment links.
- Provider adapters and idempotent payment state machines.
- Strict separation between display balances and authoritative ledger balances.
- Compliance, licensing, KYC/AML and regional availability gates before launch.

### Media
- Secure media/document/link uploads and galleries.
- Status/stories with audience, expiry and reporting.
- Transcoding/thumbnail pipeline, file validation, malware scanning and retention controls.

### AI
- Explicit opt-in assistant surfaces.
- User-visible source attribution and permission-aware retrieval.
- Drafting, summarization and task/workflow assistance.
- Tenant isolation, prompt-injection defenses, data minimization and no training on private content without explicit consent.

## 5. Global quality and governance

- Security baseline: OWASP ASVS 5.0 and OWASP API Security Top 10.
- Accessibility target: WCAG 2.2 AA.
- Privacy by design: purpose limitation, export/delete workflows, consent, retention schedules and regional legal review.
- Reliability: idempotent writes, retries, dead-letter handling, backups, restore drills and incident runbooks.
- Observability: structured logs, metrics, traces, audit events and privacy-safe diagnostics.
- Internationalization: locale-aware dates, numbers, language strings and time zones.
- Low-bandwidth and mobile-first performance, including offline-safe drafts and resilient reconnect.

## 6. Non-negotiable deployment boundary

| Concern | PTU-hosted SsibuChat | Independent SsibuChat |
|---|---|---|
| Tester authority | PTU Master Admin Console (MAC) | Independent SsibuChat admin console |
| Authentication | Existing PTU identity/session | Independent SsibuChat identity/session |
| Database | Existing PTU-owned Mongo data | Independent product database/namespace |
| Secrets | PTU environment and operator controls | Independent Vercel environment |
| Release | PTU release process | Independent release process |
| Integration | Preserve existing PTU routes, APIs and delivery rails | Explicit, least-privilege integration adapters only |

The independent product must never call PTU MAC to decide whether an independent tester can sign in. PTU MAC must not be replaced by a second authority for PTU-hosted tester access.

## 7. Audit limitations

This audit is source-level. It does not prove the state of live production accounts, Vercel environment variables, MongoDB Atlas network rules/indexes/backups, provider webhook settings, storage buckets, WebRTC/TURN infrastructure or actual user experience. Those require authorized runtime checks and test credentials; no secrets should be pasted into chat.


## 8. Independent implementation delta (2026-11-18)

The independent repository now has an implementation branch and draft PR with the following delivered foundations: independent account/session auth, independent tester policy, fail-closed origin validation, persistent auth throttling, Connect direct/group threads and message history, idempotent message writes with retry-repairable outbox events, Work workspace/project/task/calendar records, Commerce business/product/draft-order records, immutable Finance bookkeeping records, Media metadata records, per-user dashboard preferences, explicit AI consent/provider adapter, responsive pillar UI, security headers, tests and operations documentation.

These changes are not merged to `main` or promoted to production. The validated CI head before later follow-on changes passed 14 tests and the production build; later commits must pass their own checks. Production dependencies audited clean on that validated head, while four high-severity dev-toolchain advisories through picomatch <=4.0.7 remain unresolved upstream.

The independent implementation does not yet provide production-complete payments, wallet custody, binary media storage, E2EE, WebRTC/TURN, push delivery, shared cross-user workspaces, complete AI retrieval/governance, MFA/recovery, or full export/deletion and operations controls. The implementation roadmap is the authoritative live checklist for those remaining items.

The PTU security branch remains a draft PR. PTU main and production have not been modified by that PR. PTU tests/build and the live Africa's Talking callback remain unverified.
