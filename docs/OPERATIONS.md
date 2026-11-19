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

The independent deployment includes an authenticated outbox worker endpoint at /api/cron/outbox. It requires CRON_SECRET and accepts an Authorization: Bearer header. Vercel Hobby rejected a five-minute cron schedule, so the repository does not register a Vercel cron. Instead, .github/workflows/outbox-worker.yml invokes the production endpoint every five minutes through GitHub Actions after that workflow reaches the repository's default branch. Configure two GitHub Actions repository secrets: SSIBUCHAT_CRON_URL (the exact HTTPS production URL ending in /api/cron/outbox) and CRON_SECRET (the same high-entropy value configured in the independent Vercel Production environment). Never place either value in source, workflow YAML, logs or chat. The scheduled workflow does not run from this feature branch; it becomes active only after merge to the default branch and successful secret configuration. Use workflow_dispatch for an authorized smoke test after deployment.

The worker claims outbox records with short leases, fans accepted messages into idempotent deliveryJobs, retries failures with exponential backoff and dead-letters after ten attempts. GitHub Actions retries transient HTTP failures twice; it is not a durable scheduler guarantee, so missed/failed runs still require monitoring and repeat-safe processing. This is an internal queueing foundation, not a live notification provider: deliveryJobs remain queued until a separately configured and tested delivery consumer/provider is added. Configure CRON_SECRET only in the independent SsibuChat deployment, never reuse PTU credentials.


## Independent MAC configuration control plane — initial implementation

The independent admin interface includes a write-only encrypted configuration inventory at **Infrastructure Control Plane → Environment & provider configuration**. Values are encrypted with AES-256-GCM and the server-only `SSIBUCHAT_CONFIG_ENCRYPTION_KEY` (exactly 32 random bytes, base64 encoded). The key must be provisioned in the independent hosting environment; never store it in MongoDB, source control, browser code or this UI. The API returns configuration metadata only and never returns plaintext values. Updates create encrypted version-history records and administrative audit events.

The initial API supports inventory, encrypted create/rotate and deletion for runtime, GitHub Actions, Vercel, Namecheap, Bluehost and other provider destinations. **Provider destinations are deliberately marked `pending_provider_adapter`: this increment does not yet synchronize them to external providers.** No provider token is provisioned by this code.

The server-only `getActiveRuntimeConfig(db, environment)` helper reads active runtime-scoped values. Existing feature modules have not all been migrated to consume this runtime service; therefore this increment alone does not make every setting live without deployment. Runtime adoption must be explicit per service, with schema validation, safe refresh, audit, rollback and tests. Build-time `VITE_*` values and platform-managed deployment variables may still require a new deployment or provider action.

Before enabling this control plane in production:
1. Generate a dedicated 32-byte encryption key using an approved secrets manager and configure `SSIBUCHAT_CONFIG_ENCRYPTION_KEY` only in the independent SsibuChat production environment.
2. Verify key backup/rotation and disaster-recovery procedures. Losing this key makes stored values unrecoverable; rotating it requires a controlled re-encryption migration.
3. Connect and test provider-specific least-privilege API credentials before enabling synchronization.
4. Keep PTU credentials and PTU MAC outside this independent vault.


## Live runtime configuration adoption — transactional email

The independent account-email service now reads activated runtime-vault entries on each send for `RESEND_API_KEY`, `SSIBUCHAT_EMAIL_FROM` and `SSIBUCHAT_APP_URL`. The database values are decrypted only in the server process and take precedence over the corresponding environment bootstrap values. If the vault encryption key is not configured, the service retains the existing environment-variable behavior. Production, preview and local-development runtime scopes are selected independently.

To activate live email configuration, first provision `SSIBUCHAT_CONFIG_ENCRYPTION_KEY` in the independent server environment, then add the three keys above in MAC with destination `runtime` and the correct environment. Saving a runtime entry activates it. The next account-email operation reads the new values without requiring an application redeployment. Provider credentials must still be valid at Resend; no provider account or secret has been provisioned by this code change.

This is an initial service-by-service adoption, not a claim that all application modules now consume the runtime vault. Other providers, object storage, AI, TURN, scheduler credentials and build-time variables still require their own explicit adapters and tests.
