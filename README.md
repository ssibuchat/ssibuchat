# SsibuChat

**Independent, multi-dimensional communication and productivity super-app.**

This repository is the independent product codebase for [ssibuchat.vercel.app](https://ssibuchat.vercel.app). It is intentionally separate from the PTU-hosted SsibuChat implementation in `payteamuniversity/payteam`.

## Product pillars

- **Connect** — private and group messaging, contacts, presence, channels, communities, voice/video calls.
- **Work** — workspaces, tasks, calendar, files, notes and collaborative workflows.
- **Commerce** — business profiles, catalogues, orders, payments and merchant tools.
- **Finance** — wallets, transaction views, payment orchestration and reconciliation (subject to licensed-provider integrations).
- **Media** — secure file and media sharing, status/stories, galleries and media management.
- **AI** — opt-in assistants, search, summaries, workflow automation and contextual help.

## Architecture decisions

1. Independent identity, authentication, user data, administration and tester controls.
2. PTU MAC remains the authority for tester access on PTU-hosted SsibuChat only. This product never calls or depends on PTU MAC.
3. Shared product concepts and compatible integration contracts are allowed; shared sessions, secrets, databases and privileged control planes are not.
4. Modular monolith first: one deployable application, bounded domains, explicit service interfaces and event contracts.
5. Vercel deployment with MongoDB Atlas persistence. Media bytes belong in object storage; MongoDB stores metadata and references.
6. Security, accessibility, observability, backups and tests are product requirements, not later polish.

## Current implementation status

The independent foundation branch now includes separate identity and tester controls, Connect messaging foundations, owner-scoped Work/Commerce/Finance/Media services, dashboard preferences, opt-in AI provider boundary, responsive pillar workspaces, rate limiting, security headers and automated tests. The current implementation is **not yet a production-complete super-app** and is kept in a draft pull request pending review. See [the audit](docs/GLOBAL_PRODUCT_AUDIT.md), [architecture](docs/ARCHITECTURE.md), [security controls](docs/SECURITY.md), [operations](docs/OPERATIONS.md) and [complete roadmap](docs/IMPLEMENTATION_ROADMAP.md) for exact scope and acceptance gates.

### Implemented foundations

- Independent registration, login, logout, opaque sessions, one-time admin bootstrap and tester policy.
- Direct/group thread creation, participant-authorized history and idempotent message writes with repairable outbox.
- Workspaces, projects, tasks and calendar-event records.
- Business profiles, product records and draft order snapshots.
- Immutable finance bookkeeping records in integer minor units.
- Media metadata records (not file uploads).
- Per-user dashboard preferences and explicit AI consent/provider adapter.
- MongoDB-backed rate limiting, origin validation and production browser security headers.
- Optional TOTP MFA with encrypted secrets, single-use recovery codes and login challenge enforcement.

### Not production complete

Payments, wallet custody, shared cross-user workspaces, binary media storage, E2EE, WebRTC/TURN, push delivery, email verification, passkeys, full AI retrieval/governance and production operations remain incomplete. Real MongoDB/Vercel MFA staging acceptance is still required before broad rollout. Do not enable regulated or provider-dependent functionality until its integration and acceptance gates pass.

## Local development

- Node.js 20+
- MongoDB connection string for API-backed features

```bash
npm ci
cp .env.example .env
npm run dev
```

The UI can run without MongoDB; API health reports configuration state without exposing secrets.

## Required environment

See `.env.example`. Never commit real credentials, provider keys, session secrets or production database URLs.

## Release rule

No production cutover until automated tests, security checks, migration/backup rehearsal, provider webhook verification and production smoke tests pass. The PTU deployment remains independently operational throughout.
