# QQURZ release promotion checklist

Deployment and launch are separate decisions. A production deployment is **not** evidence that QQURZ is finished or launch-ready. The top-level acceptance contract is [`LAUNCH_BAR.md`](LAUNCH_BAR.md).

## Development

- Quality gates pass.
- Local/test accounts and realtime flows work.
- Only test payment credentials are present.
- Push/merge to `develop`; development frontend/API deploy automatically.

## Staging

- Promote reviewed development work to `staging`.
- Quality gates and mobile overlap audit pass.
- Account creation/login, matchmaking, tournament registration, reconnect, history/rating and operator views work against the staging API.
- Complete at least one full Chess960 game through each launch-critical play path being promoted.
- Exercise large/extra text, dark/light mode and reduced-motion states.
- Stripe/Nuvei tests use provider sandbox/test credentials only.
- Verify `GET /_health` reports `staging` and the expected release.
- Exercise migrations on staging before production.

## Production deployment

- Promote the staged release to `main`.
- Require GitHub `production` environment approval.
- Verify the migration and rollback plan before approving a schema-changing deploy.
- Keep `PAYMENTS_MODE=disabled`, `NUVEI_ENV=disabled`, and all real-money competition flags disabled until the separate paid-events launch bar passes.
- Verify `GET /_health` reports `production` after deployment.
- Confirm custom domains use HTTPS and point to the production frontend/API only.

## Core launch promotion

A production build may be promoted to **core launch-ready** only when every core requirement and evidence item in [`LAUNCH_BAR.md`](LAUNCH_BAR.md) passes for the same release commit, including:

- first-run comprehension;
- account creation/sign-in;
- tournament, friend and same-device entry paths;
- a complete correct Chess960 game and clock flow;
- disconnect/reconnect integrity;
- durable history/rating visibility;
- large-text, dark/light and reduced-motion usability;
- production build, bundle, E2E, visual and overlap gates;
- a physical iPhone 11-class Safari pass.

A passing CI subset does not waive a missing launch-bar item.

## Paid-events promotion

Do not enable real-money competition flags until the separate paid-events section of [`LAUNCH_BAR.md`](LAUNCH_BAR.md) is complete and independently approved. At minimum this includes audited ledger behavior, refunds, webhook recovery/reconciliation, legal/compliance review, anti-cheat operations, support procedures and verified payouts.

## Rollback readiness

Before a high-risk release, record the current Cloudflare Worker version ID and last known-good Git SHA. Use the recovery runbook if rollback is needed.
