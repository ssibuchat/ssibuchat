# Independent SsibuChat MAC

## Canonical route

The independent SsibuChat Management & Administration Console is served at:

- `https://ssibuchat.vercel.app/mac` in production, once this branch is merged and deployed.
- `/mac` on local and preview deployments.

The route is deliberately separate from the PTU-hosted product and its MAC. PTU tester access remains governed only by PTU MAC. Independent SsibuChat MAC accepts only an authenticated account with `role: "admin"` in the independent SsibuChat database and session store.

## Current console capabilities

- Independent administrator session check and role gate.
- Independent tester inventory, creation and global tester sign-in enable/disable.
- Tester sign-in remains disabled by default; disabling access revokes tester sessions.
- Encrypted configuration inventory and write-only secret rotation through the infrastructure control plane.
- Recent independent administrative audit events.
- Link back to the independent product; administrator navigation is exposed from the signed-in app.

## API authorization

The UI calls the existing `/api/auth/me`, `/api/admin/testers`, `/api/admin/testers/access`, `/api/admin/audit` and `/api/admin/config` endpoints. The server independently checks the session and administrator role for every `/api/admin/*` request. Hiding the UI is not relied on as an authorization boundary.

## Deployment and acceptance status

This route is implemented on `implementation/superapp-foundations` and is not available on the production default branch until the pull request is reviewed, merged and deployed. It still requires CI on the final head, a private preview login test using an independent admin account, non-admin denial tests, tester-policy tests against the independent production-like database, and a deployment smoke test.

The configuration vault currently encrypts stored values but does not yet synchronize GitHub Actions, Vercel, Namecheap or Bluehost. Provider adapters, credential provisioning, runtime adoption, secret rotation/recovery procedures and end-to-end verification remain separate work. Do not treat the MAC page as proof those integrations are operational.

Never enter provider credentials into chat, source control, browser-visible variables or logs. Configure production secrets directly in the relevant provider's protected secret manager.
