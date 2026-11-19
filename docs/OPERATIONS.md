# SsibuChat Independent Deployment & Operations

## Deployment boundary
Create a dedicated Vercel project connected only to `ssibuchat/ssibuchat`. Do not attach the PTU project, PTU environment variables, PTU MongoDB database or PTU session cookies.

## MongoDB Atlas
1. Create a dedicated Atlas project/database for SsibuChat.
2. Create a least-privilege database user restricted to the product database.
3. Restrict network access to the deployment environment where practical; do not leave broad public access enabled.
4. Configure automated backups and point-in-time recovery according to the selected Atlas tier.
5. Review and rehearse restoration before production data is accepted.

## Vercel environment
Configure `MONGODB_URI`, `MONGODB_DB`, `SSIBUCHAT_BOOTSTRAP_SECRET`, and `SSIBUCHAT_SESSION_SECRET` in the independent project only. Use unique, high-entropy secrets. Do not place secrets in source, client-side variables, build logs or support tickets.

## First administrator
1. Deploy the application to a private preview URL.
2. Call `POST /api/auth/bootstrap` once with the bootstrap secret, a valid email and a password of at least 12 characters.
3. The bootstrap endpoint permanently refuses a second bootstrap once an admin exists.
4. Remove/rotate the bootstrap secret after successful setup and verify admin login.
5. Tester access defaults to disabled. The independent admin can create tester accounts and enable access using `/api/admin/testers` and `PATCH /api/admin/testers/access`.

## Current API surface
- `GET /api/health`
- `POST /api/auth/bootstrap`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/admin/testers`
- `POST /api/admin/testers`
- `PATCH /api/admin/testers/access`
- `GET /api/threads`
- `POST /api/messages`
- `GET|PUT /api/workspace/preferences`
- `GET|PUT /api/ai/consent`, `POST /api/ai/chat`
- `GET|POST /api/modules/workspaces|projects|tasks|events`
- `GET|POST /api/modules/businesses|products|orders`
- `GET|POST /api/modules/finance|media`
- `PATCH|DELETE /api/modules/{module}/{id}` for mutable non-financial records.

The Work/Commerce/Finance/Media endpoints are owner-scoped foundational records. Orders are draft snapshots only; finance entries are immutable bookkeeping records; media stores metadata only. AI calls require explicit opt-in and configured `SSIBUCHAT_AI_BASE_URL`, `SSIBUCHAT_AI_API_KEY`, and `SSIBUCHAT_AI_MODEL`. None of these foundations imply payment settlement, wallet custody, binary media uploads or complete AI governance.

## Operational limitations to close before launch
- Add distributed rate limiting and login abuse detection.
- Add CSRF token enforcement in addition to same-origin checks.
- Add email verification, password recovery, MFA and device/session management.
- Add a transactional outbox consumer and push provider.
- Configure object storage, malware scanning and retention.
- Configure provider-specific signed webhook verification and replay protection.
- Configure TURN and WebRTC signaling before advertising calls.
- Add alerting, audit exports, incident response and backup restore drills.
- Complete accessibility, load, integration and security testing on the real deployment.

## Safe rollout
Preview → automated tests → staging data → backup/restore rehearsal → security review → production canary → monitored gradual rollout. PTU-hosted SsibuChat is not cut over or modified by independent deployment.


## Dual-deployment release isolation
PTU-hosted SsibuChat remains on `payteamuniversity/payteam`, preserving PTU authentication and MAC as the authority for PTU tester access. Independent SsibuChat remains on `ssibuchat/ssibuchat`, with its own MongoDB database, session secret, bootstrap secret, admin and tester policy. Use separate branches, previews, environment variables and rollback procedures. A change to one repository must not trigger a deployment or secret change in the other.


## Connect outbox worker operations

The independent deployment includes an authenticated outbox worker endpoint at /api/cron/outbox. It requires the Vercel CRON_SECRET environment variable and accepts Vercel's Authorization: Bearer header. The repository now registers this endpoint every five minutes in vercel.json. This cadence requires a Vercel plan that supports per-minute cron schedules (Pro/Enterprise); Hobby supports at most one run per day and is not an acceptable runtime for this queue cadence. Verify the independent project's plan and configure CRON_SECRET in its Production environment before relying on scheduled execution. Vercel Cron invokes Production deployments only; preview builds do not prove scheduler activation.

The worker claims outbox records with short leases, fans accepted messages into idempotent deliveryJobs, retries failures with exponential backoff and dead-letters after ten attempts. Vercel does not guarantee retries for failed cron invocations, so the durable worker must remain safe for repeated calls and operational monitoring must alert on missed/failed runs. This is an internal queueing foundation, not a live notification provider: deliveryJobs remain queued until a separately configured and tested delivery consumer/provider is added. Configure CRON_SECRET only in the independent SsibuChat deployment, never reuse PTU credentials.
