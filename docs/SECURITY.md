# Security and privacy controls

## Identity and sessions
Independent accounts use scrypt password hashes and random opaque session tokens. Only HMAC token digests are persisted. Sessions expire and are invalidated on logout. Admin bootstrap is one-time and requires both `SSIBUCHAT_BOOTSTRAP_SECRET` and `SSIBUCHAT_SESSION_SECRET`. TOTP MFA secrets are encrypted with AES-256-GCM using a separate deployment-specific `SSIBUCHAT_MFA_ENCRYPTION_KEY`; recovery codes are stored only as HMAC hashes and are consumed once. MFA setup returns a provisioning secret only to the authenticated account for authenticator enrollment. Do not reuse the MFA encryption key between PTU and independent deployments.

## Request integrity
State-changing browser requests fail closed if Origin and Referer are both absent, opaque or foreign. Same-origin Referer is supported for clients that omit Origin. Do not add permissive CORS to cookie-authenticated endpoints.

## Authorization and tenant isolation
- The authenticated principal determines tenant and owner scope.
- API request bodies cannot set `ownerId` or `tenantId`.
- Thread message reads and writes verify participant membership.
- Module references are resolved under the current owner and tenant.
- Admin routes require independent SsibuChat role=admin.
- Independent tester access is controlled by independent tester policy; PTU MAC is not consulted.

## Sensitive product areas
- Finance records are immutable audit-style records; no balance, transfer, custody or settlement is implied.
- Orders are draft snapshots; payment status remains not_started until a real payment provider integration is implemented and reconciled.
- Media API stores metadata only; it does not claim file bytes are uploaded or scanned.
- AI is disabled until the user opts in and provider configuration exists. Opt-out deletes stored AI conversation records for that user.
- Do not store card PAN, CVV, bank credentials, passwords, access tokens or raw provider secrets in module records.

## Production gates
Before launch: independent security review, rate limiting, MFA/recovery, email verification, CSP/HSTS, dependency scanning, backup/restore exercise, log redaction, incident response, data retention/deletion workflows and provider-specific compliance review. Keep secrets in deployment secret stores, never source control.
