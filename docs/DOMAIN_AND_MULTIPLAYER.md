# QQURZ Chess — domain + live multiplayer deployment

The production brand/domain is **QQURZ Chess** at **qqurzchess.com**.

## 1. Connect the GoDaddy domain to GitHub Pages

The domain can stay registered at GoDaddy while the static React site stays hosted by GitHub Pages. You do **not** need a separate GoDaddy web-hosting plan just to use the GoDaddy domain.

Because this repository deploys Pages through a custom GitHub Actions workflow, GitHub requires the custom domain to be configured in **Repository Settings → Pages**. A repository `CNAME` file is ignored for this workflow style.

In GitHub:

1. Open `matthewcodergamer/Chess`.
2. Open **Settings → Pages**.
3. In **Custom domain**, enter `qqurzchess.com` and save.
4. After DNS resolves, enable **Enforce HTTPS**.

In GoDaddy DNS, point the apex/root (`@`) to GitHub Pages with these four A records:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

Then add:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | www | matthewcodergamer.github.io |

Remove conflicting `@` A/AAAA/ALIAS/ANAME records or a conflicting `www` CNAME before expecting GitHub's HTTPS certificate to issue. DNS changes can take time to propagate.

The Vite build uses `base: './'`, so the same artifact works both at the fallback project URL and at the root of `qqurzchess.com`.

## 2. Deploy the live multiplayer server

GitHub Pages is static hosting. Cross-internet multiplayer therefore runs through the included Cloudflare Worker + Durable Object server in `server/`.

The server is authoritative for:

- room creation/joining and private seat tokens
- the Chess960 position and pattern lock
- legal move validation
- shared strategy phase
- clocks and time forfeits
- check/checkmate/game result
- WebSocket synchronization between both players

Deploy it from a Cloudflare account:

```bash
cd server
npm install
npm run deploy
```

Wrangler will print a URL similar to:

```text
https://qqurz-chess-api.YOUR-SUBDOMAIN.workers.dev
```

Then in the GitHub repository create an **Actions variable** named `VITE_MULTIPLAYER_API` containing that HTTPS URL. The Pages workflow injects it at build time. Push or manually rerun the Pages workflow after setting the variable.

If you later want the API on the QQURZ domain, route something such as `api.qqurzchess.com` to the Worker and set `VITE_MULTIPLAYER_API=https://api.qqurzchess.com`.

## 3. Real-money tournaments

The repository deliberately keeps paid tournament collection disabled. The tournament UI and backend roadmap can show entry/prize concepts, but money should not be accepted until the business is approved for every jurisdiction being served and an appropriate payment processor explicitly approves the model.

Do not wire ordinary Stripe checkout to paid-entry prize chess without approval: Stripe's current restricted-business policy explicitly lists games of skill/board-game competitions with monetary/material prizes and entry/player fees promising prizes under gambling restrictions.

For Jamaica, obtain professional legal/regulatory advice and a classification from the Betting, Gaming & Lotteries Commission before launching any paid-entry/prize or betting feature. Chess is highly skill-based, so do not assume the BGLC's general “prize competition” process automatically applies; get the activity classified first.

A safe production sequence is:

1. Launch free accounts, rooms, ratings and free tournaments.
2. Add anti-cheat, moderation, audit logs and identity/age controls.
3. Obtain jurisdiction-specific legal/regulatory review.
4. Obtain written approval from a processor that supports the approved business model.
5. Only then enable deposits, entry fees, prize escrow/payouts or betting-like functionality.
