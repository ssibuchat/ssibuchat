# SsibuChat Architecture

## 1. Deployment topology

```text
Browser / PWA / Mobile clients
          |
       Vercel
          |
  React + Vite application
          |
  Versioned API boundary
          |
  Modular application services
   |      |       |       |
 Auth   Connect  Work   Commerce/Finance/Media/AI
   |      |       |       |
          MongoDB Atlas
             |
   Object storage / CDN (media bytes)
             |
  Event delivery / push / WebRTC signaling
```

PTU-hosted SsibuChat is a separate deployment and trust domain. Integration is through explicit APIs/webhooks with scoped credentials, not shared cookies or direct cross-database access.

## 2. Modular monolith boundaries

Start with one deployable backend to reduce operational complexity, but keep domain boundaries explicit:

- identity: accounts, credentials, sessions, devices, MFA and recovery.
- access: roles, memberships, tenant boundaries, tester policy and authorization.
- connect: threads, messages, contacts, presence, receipts, channels, communities and calls.
- work: workspaces, tasks, calendar, notes and activity.
- commerce: business profiles, catalogues, orders and merchant support.
- finance: payment intents, provider adapters, transaction references and reconciliation.
- media: upload intents, metadata, scanning, transformations and retention.
- ai: consent, model adapters, retrieval, audit and usage.
- platform: settings, notifications, event outbox, audit log, feature flags and observability.

Modules may share infrastructure libraries, but must not reach into each other's collections without a defined service contract.

## 3. Data ownership and tenancy

Every tenant-owned document carries `tenantId`, `createdAt`, `updatedAt`, and where appropriate `createdBy`, `visibility`, `status`, and a schema version. Every request resolves a principal and tenant server-side. Never trust a client-supplied tenant or participant identity.

Suggested collections: users, credentials, sessions, devices, tenants, memberships, testerPolicies, threads, messages, messageReceipts, contacts, presence, channels, communities, calls, workspaces, tasks, files, uploadIntents, businesses, catalogItems, orders, paymentIntents, notifications, auditEvents, outboxEvents and appSettings.

Indexes are created through versioned migrations. Unique constraints cover normalized usernames, tenant membership and idempotency keys. All list APIs are paginated and bounded.

## 4. Authentication and tester access

Independent identity is fully separate from PTU.

- Password hashes use a modern memory-hard KDF; sessions use random opaque tokens, HttpOnly/Secure/SameSite cookies and server-side expiry/revocation.
- Enforce CSRF protection for cookie-authenticated mutations, rate limits and login throttling.
- Optional MFA and recovery flows.
- Admin bootstrap requires deployment-time secrets; no built-in universal admin password.
- Tester accounts are marked as test principals and cannot silently gain production privileges.
- Independent tester access is controlled only by independent admin policy. Default disabled until configured. Disabling it blocks tester principals only, revokes their sessions, and leaves legitimate users and test data intact.
- PTU tester access is controlled only by PTU MAC. No dependency on this independent policy.

## 5. Messaging and event reliability

Write message + outbox event atomically where MongoDB transaction support is available. Event consumers are idempotent. Delivery state is per recipient. Retry transient failures with bounded exponential backoff and dead-letter handling. Push delivery uses a provider adapter; reconnect falls back to cursor-based sync. Never use WebSocket delivery as the sole source of truth.

## 6. Media

Use object storage for bytes. API creates a short-lived upload intent after authorization; client uploads directly using a signed URL; completion verifies size, MIME, checksum and ownership. Scan before making content available. Downloads are authorized and short-lived. MongoDB stores metadata, not arbitrary base64 payloads.

## 7. Calls

WebRTC media flows peer-to-peer where possible, through TURN when required. Signaling is authenticated and short-lived. Persist call lifecycle metadata only; do not store media unless explicit recording consent and legal requirements are satisfied. Include permission, abuse, blocking and emergency hang-up paths.

## 8. Security and privacy

- TLS everywhere; encryption at rest via managed platform/database controls.
- E2EE is a separate protocol project: audited key management, device identity, multi-device key sync, group rekey, recovery trade-offs and secure attachment encryption.
- Audit administrative and sensitive actions without logging message bodies, passwords, tokens or private media.
- Data export, deletion, retention and legal hold workflows.
- AI retrieval must enforce the same access checks as the source data.

## 9. Integration contracts

PTU compatibility is an adapter, never a shared identity system. Use signed, timestamped requests with audience, scope, expiry, replay protection and key rotation. Map only the minimum claims required. The independent service must continue operating when PTU is offline; PTU must continue operating when independent SsibuChat is offline.


## 10. Current implementation contracts (foundation branch)

The current API implementation is a modular monolith with owner- and tenant-scoped module records:
- Connect: `/api/threads`, `/api/messages`, `/api/people`.
- Work: `/api/modules/workspaces`, `projects`, `tasks`, `events`.
- Commerce: `/api/modules/businesses`, `products`, `orders`. Orders are draft snapshots only.
- Finance: `/api/modules/finance`. Immutable bookkeeping records in integer minor units; no wallet custody or payment settlement.
- Media: `/api/modules/media`. Metadata only; binary storage and signed uploads are provider-dependent.
- AI: `/api/ai/consent`, `/api/ai/chat`. Requires explicit user opt-in and server-side OpenAI-compatible provider configuration.
- Workspace: `/api/workspace/preferences`. Personal dashboard preferences; cross-user shared workspace membership is not yet available.

These service contracts are foundational and do not imply that provider-dependent production capabilities are complete.
