# qqurzchess Cloudflare + sign-in setup

The website is static on GitHub Pages. Accounts, presence, rooms and payments live on the Cloudflare Worker `qqurz-chess-api`.

Production Worker: `https://qqurz-chess-api.gamerstriper.workers.dev`

## What I already wired

- Online players dropdown reads `/presence/players` (this endpoint is now routed).
- Google and Apple buttons call the Worker OAuth start URLs.
- After a successful social login you return to `https://qqurzchess.com/?social=success&token=...` and the account is stored.

## You still need to add secrets

I cannot log into Google Cloud, Apple Developer, or Cloudflare for you. Add these, then push or redeploy.

### 1. Google

1. [Google Cloud credentials](https://console.cloud.google.com/apis/credentials)
2. Create **Web application** OAuth client
3. Origins: `https://qqurzchess.com`
4. Redirect: `https://qqurz-chess-api.gamerstriper.workers.dev/account/google/callback`
5. GitHub repo → Settings → Secrets → Actions:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

### 2. Apple

Requires a paid Apple Developer account.

- Services ID return URL: `https://qqurz-chess-api.gamerstriper.workers.dev/account/apple/callback`
- Secrets: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`

### 3. Live Stripe on the Worker (optional, Payment Link already live)

- Secret: `STRIPE_LIVE_SECRET_KEY` = `sk_live_...`
- Then set production `PAYMENTS_MODE=live` in `server/wrangler.jsonc`

### 4. Deploy

Push to `main`. `deploy-realtime.yml` deploys the Worker. `deploy-pages.yml` deploys the site.

Local Worker deploy:

```bash
cd server
npx wrangler login
npx wrangler deploy --env production
```
