# QQURZ release promotion checklist

## Development

- Quality gates pass.
- Local/test accounts and realtime flows work.
- Only test payment credentials are present.
- Push/merge to `develop`; development frontend/API deploy automatically.

## Staging

- Promote reviewed development work to `staging`.
- Quality gates and mobile overlap audit pass.
- Account creation/login, matchmaking, tournament registration, reconnect, and operator views work against the staging API.
- Stripe/Nuvei tests use provider sandbox/test credentials only.
- Verify `GET /_health` reports `staging` and the expected release.
- Exercise migrations on staging before production.

## Production

- Promote the staged release to `main`.
- Require GitHub `production` environment approval.
- Verify the migration and rollback plan before approving a schema-changing deploy.
- Keep `PAYMENTS_MODE=disabled`, `NUVEI_ENV=disabled`, and all real-money competition flags disabled until a separate live-money launch review.
- Verify `GET /_health` reports `production` after deployment.
- Confirm custom domains use HTTPS and point to the production frontend/API only.

## Rollback readiness

Before a high-risk release, record the current Cloudflare Worker version ID and last known-good Git SHA. Use the recovery runbook if rollback is needed.
