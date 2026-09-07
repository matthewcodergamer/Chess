# QQURZ Chess — U.S. launch, custom domain + live multiplayer

The production brand is **QQURZ Chess** and the public domain is **qqurzchess.com**. QQURZ is being built as a U.S.-based chess platform with global online play where the service is available.

## 1. Connect the GoDaddy domain to GitHub Pages

The domain can remain registered and managed at GoDaddy while the React frontend stays hosted by GitHub Pages. Buying a GoDaddy domain does not require moving the static frontend onto a separate GoDaddy hosting product.

Because this repository deploys Pages through a custom GitHub Actions workflow, GitHub requires the custom domain to be configured in **Repository Settings → Pages**. GitHub's current documentation says that when Pages is published by a custom Actions workflow, a repository `CNAME` file is not required and any existing one is ignored.

### GitHub

1. Open `matthewcodergamer/Chess`.
2. Open **Settings → Pages**.
3. In **Custom domain**, enter `qqurzchess.com` and save.
4. After DNS resolves and GitHub makes the option available, enable **Enforce HTTPS**.
5. GitHub also recommends verifying ownership of the custom domain for takeover protection.

### GoDaddy DNS

Point the apex/root (`@`) to GitHub Pages with all four A records:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

Then add the `www` alias:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | www | matthewcodergamer.github.io |

Remove conflicting default `@` A/AAAA/ALIAS/ANAME records or a conflicting `www` CNAME. Avoid wildcard DNS records such as `*.qqurzchess.com` unless there is a specific, secured reason to use one.

GitHub notes that DNS propagation can take up to 24 hours. The Vite build uses `base: './'`, so the same production artifact works at the custom-domain root as well as the GitHub Pages fallback URL.

Official GitHub reference: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

## 2. Deploy the live cross-network multiplayer server

GitHub Pages is static hosting, so two browsers on different internet connections need a realtime server. QQURZ now includes an authoritative Cloudflare Worker + Durable Object implementation in `server/`.

Cloudflare recommends Durable Objects for coordinating multiplayer clients and recommends its WebSocket Hibernation API for long-lived realtime connections. The server uses a SQLite-backed Durable Object and keeps the browser clients synchronized through WebSockets.

The server owns and validates:

- private six-character room codes and private seat tokens
- White/Black seats and reconnectable room sessions
- Chess960 position generation and pattern locking
- legal moves on the server with `chessops`
- shared two-minute strategy phase
- authoritative 10-minute clocks and time forfeits
- check, checkmate, draws and resignation results
- player connectivity/presence
- WebSocket snapshots sent to both players

The browser is not trusted to decide whether a move is legal or who won.

### Deploy

```bash
cd server
npm install
npm run check
npx wrangler login
npm run deploy
```

Wrangler will print an HTTPS Worker URL. Add that URL to the GitHub repository as an **Actions variable** named:

```text
VITE_MULTIPLAYER_API
```

Then rerun the Pages workflow or push a new commit. The frontend will activate **Create private room** and **Join** once that value is present at build time.

For the final production layout, map a hostname such as `api.qqurzchess.com` to the Worker and use:

```text
VITE_MULTIPLAYER_API=https://api.qqurzchess.com
```

Cloudflare references:

- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/workers/wrangler/configuration/

## 3. U.S. tournament model: entry fee + prize fund, not wagering

QQURZ's intended paid-event model is a **chess skill tournament**: a player registers for a tournament, pays a disclosed tournament entry fee, competes under published chess rules, and prizes are awarded based on chess performance. The product should not use betting language, odds, wagers, side bets, or player-vs-player staking.

This model resembles ordinary U.S. chess tournament registration. For example, the 2026 National Open publishes both entry fees and a $125,000 guaranteed prize fund, while the 2026 U.S. Open publishes entry fees and a separate prize-fund schedule.

That business framing does **not** by itself make every paid online tournament lawful everywhere in the United States. Current consumer/legal guidance supports two important points:

- The FTC distinguishes skill contests from sweepstakes and notes that a skills contest can ask participants to pay to play.
- U.S. contest law varies by state. When payment is required, winners generally need to be determined by genuine skill rather than chance, and some states impose additional restrictions or requirements. Official rules and state eligibility therefore matter.

References:

- FTC: https://consumer.ftc.gov/articles/fake-prize-sweepstakes-and-lottery-scams
- ABA overview of U.S. state contest law: https://www.americanbar.org/groups/gpsolo/resources/ereport/archive/sales-promotions-contests-sweepstakes/
- US Chess 2026 National Open: https://new.uschess.org/2026-national-open
- US Chess 2026 U.S. Open registration: https://new.uschess.org/us-open-2026/registration
- US Chess 2026 U.S. Open prizes: https://new.uschess.org/us-open-2026/prizes

## 4. Payment-provider constraint

Do not assume an ordinary card checkout account can be switched on just because the product calls itself a skill tournament. Stripe's current restricted-business page specifically lists games of skill/board-game competitions with monetary or material prizes and entry/player fees promising a prize under its gambling-related restrictions.

Reference: https://stripe.com/legal/restricted-businesses

Therefore the production sequence is:

1. Launch accounts, private rooms, ratings and **free** tournaments first.
2. Add server-side anti-cheat signals, fair-play review, moderation, audit logs and tournament-director tools.
3. Draft U.S. Official Rules with eligibility, format, tie handling, refunds/cancellations, disqualification, prize amounts and dispute procedures.
4. Add age/identity controls and determine which U.S. states may participate.
5. Obtain U.S. counsel review of the exact online entry-fee/prize structure, including state-by-state restrictions.
6. Arrange tax reporting/withholding and prize-payout operations as applicable.
7. Obtain written approval from a payment provider that supports the approved business model.
8. Only after those gates are complete, enable paid registration and prize payouts.

The current source intentionally has **no deposit, wagering, entry-fee collection, escrow or cash-payout endpoint**. The $500 card in the UI is a product-roadmap example, not a live offer or checkout.
