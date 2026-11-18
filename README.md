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

This first commit establishes the independent product foundation and implementation blueprint. It is **not yet a production-complete super-app**. See [the audit](docs/GLOBAL_PRODUCT_AUDIT.md), [architecture](docs/ARCHITECTURE.md) and [roadmap](docs/IMPLEMENTATION_ROADMAP.md) for the full scope and acceptance gates.

## Local development

- Node.js 20+
- MongoDB connection string for API-backed features

```bash
npm install
cp .env.example .env
npm run dev
```

The UI can run without MongoDB; API health reports configuration state without exposing secrets.

## Required environment

See `.env.example`. Never commit real credentials, provider keys, session secrets or production database URLs.

## Release rule

No production cutover until automated tests, security checks, migration/backup rehearsal, provider webhook verification and production smoke tests pass. The PTU deployment remains independently operational throughout.
