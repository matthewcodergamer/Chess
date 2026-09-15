# QQURZ deployment environments

QQURZ uses an explicit promotion chain:

`Development -> Staging -> Production`

The frontend and API are isolated per environment. Production is not a test environment for payment logic.

## Branch promotion

| Branch | Environment | Frontend | API |
| --- | --- | --- | --- |
| `develop` | development | `qqurz-chess-web-development` | `qqurz-chess-api-development` |
| `staging` | staging | `qqurz-chess-web-staging` | `qqurz-chess-api-staging` |
| `main` | production | `qqurz-chess-web-production` | `qqurz-chess-api` |

Normal release flow:

1. Build and test on `develop`.
2. Promote the exact reviewed work to `staging` and test real account/realtime flows there.
3. Test payment integrations only with provider test credentials in staging.
4. Promote to `main` only after staging passes.
5. Production deployments use the GitHub `production` environment and should have required reviewers enabled in repository settings.

Do not bypass staging for a production release.

## Frontend hosting

The automatic frontend deployment workflow now targets Cloudflare Pages rather than GitHub Pages. Create these Direct Upload projects once in Cloudflare before the first deployment:

- `qqurz-chess-web-development`
- `qqurz-chess-web-staging`
- `qqurz-chess-web-production`

Attach custom domains only after the projects exist. Recommended domains:

- development: `dev.qqurzchess.com`
- staging: `staging.qqurzchess.com`
- production: `qqurzchess.com` and `www.qqurzchess.com`

Cloudflare supplies HTTPS for Pages deployments and custom domains after DNS/domain setup is complete.

GitHub Pages can remain available as an emergency/static fallback, but it is no longer the production deployment path once accounts, realtime state, and payments are part of the product.

## API hosting

The API uses Cloudflare Workers + SQLite-backed Durable Objects. `server/wrangler.jsonc` defines three separate Wrangler environments with distinct Worker names and therefore isolated Durable Object namespaces/storage.

Never point development or staging at the production API.

The API exposes `GET /_health` and `GET /healthz`. A successful deployment returns the deployment environment and release identifier and the workflow smoke-tests this before declaring the deployment successful.

## GitHub environment configuration

Create GitHub Environments named exactly:

- `development`
- `staging`
- `production`

Recommended protection:

- Development: no manual approval required.
- Staging: optional approval.
- Production: required reviewer and deployment-branch restriction to `main`.

Environment variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_MULTIPLAYER_API`
- `API_BASE_URL`

Environment secrets used by the API workflow:

- `CLOUDFLARE_API_TOKEN`
- `PAYMENTS_INTERNAL_SECRET`
- `PAYMENTS_INTENT_SECRET`
- `PAYMENTS_COMPLIANCE_WEBHOOK_SECRET`
- `INTEGRITY_INTERNAL_SECRET`
- `INTEGRITY_ADMIN_SECRET`
- `INTEGRITY_SIGNAL_SECRET`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`

Development/staging test-provider secrets only:

- `STRIPE_TEST_SECRET_KEY` (`sk_test_...` only)
- `STRIPE_TEST_WEBHOOK_SECRET`
- `NUVEI_TEST_MERCHANT_ID`
- `NUVEI_TEST_MERCHANT_SITE_ID`
- `NUVEI_TEST_SECRET_KEY`

Do not place provider live secrets in development or staging GitHub environments.

## Payment isolation

The committed baseline is intentionally strict:

- Development: Stripe/Nuvei test mode only.
- Staging: Stripe/Nuvei test mode only.
- Production: payment creation/webhook money-changing routes are fail-closed because `PAYMENTS_MODE=disabled` and `NUVEI_ENV=disabled`.
- Real-money competition remains disabled in every environment.

The server also has a runtime guard. It rejects live payment mode outside production and rejects test-provider operation in production.

Turning on live production payments must be a separate reviewed change that updates configuration, provider secrets, compliance approvals, and tests together. Never temporarily paste a live key into staging to "see if it works".

## Local development

Frontend:

```bash
cp .env.example .env.local
npm install
npm run dev
```

API:

```bash
cd server
cp .dev.vars.example .dev.vars.development
npm install
npx wrangler dev --env development
```

`.env*`, `.dev.vars*`, and server local secret files are gitignored. Only example files are committed.

## Database migrations

The canonical data store uses ordered schema migrations in `server/src/data/migrations.ts`.

Rules:

1. Never rewrite an already-deployed migration.
2. Increment `LATEST_DATA_SCHEMA_VERSION` for each schema change.
3. Migrations must be forward-safe and transactional where possible.
4. Staging must run the migration before production.
5. Old Worker code must not be assumed compatible with a newer schema. Review data compatibility before any code rollback.

`npm run check:data` and `npm run check:deploy` are release gates.

## Backups and recovery

All committed Durable Object exports use SQLite storage. Cloudflare SQLite-backed Durable Objects provide point-in-time recovery history for the previous 30 days. This is the baseline operational backup mechanism for QQURZ Durable Object state.

Before a high-risk production migration:

1. Verify the production Worker is healthy.
2. Record the active Worker version/deployment ID.
3. Record the release SHA and current schema version from operations/health tooling.
4. Confirm the affected Durable Object classes remain SQLite-backed.
5. Deploy to staging first and exercise account, tournament, payment-ledger, and game-state paths.
6. Deploy production only after the migration and rollback plan are reviewed.

For retention beyond the platform PITR window, add periodic encrypted logical exports to a separate backup store before real-money production launch.

## Rollback

### Frontend

Use `Deploy QQURZ frontend environment` with `workflow_dispatch`, select the environment, and provide a previously known-good commit/tag in `source_ref`. Cloudflare Pages keeps deployments immutable, so redeploying the known-good artifact is the frontend rollback path.

### API code/config

Use `Roll back QQURZ API environment` and provide the target environment plus a known-good Cloudflare Worker version ID. The workflow uses Wrangler rollback.

Important: a Worker code rollback does **not** roll back Durable Object storage. If a deployment changed data in an incompatible way, use the data/PITR recovery plan rather than blindly rolling code backward.

## One-time Cloudflare setup

1. Create the three Pages projects listed above.
2. Add the custom domains and DNS records.
3. Create a scoped Cloudflare API token that can deploy the three Pages projects and three Workers; store it only in the matching GitHub environments.
4. Verify each environment's `API_BASE_URL` and `VITE_MULTIPLAYER_API` points to its own API.
5. Configure production GitHub Environment approval before the first production deployment.

After that, normal deployments are branch-driven and environment-gated.
