# QQURZ backend modules

QQURZ is a **modular monolith**. These folders are logical service boundaries inside one Worker/repository; they are not independently deployed microservices.

## Rules

1. `gateway.ts` is only a Cloudflare composition/export shim. Transport routing lives in `modules/realtime`.
2. New gateway code imports module facades, never implementation files such as `accounts.ts`, `fairPlay.ts`, or `paymentApi.ts` directly.
3. A module owns its domain invariants and public entry points. Other modules should depend on that public facade rather than duplicating business logic.
4. Durable Object class names remain stable for Cloudflare migrations. The facade may export an existing/canonical wrapper class without renaming the binding.
5. Cross-Durable-Object persistence continues through the canonical data projection/outbox layer. Module separation does not imply distributed transactions.
6. Do not add per-module `package.json`, Wrangler config, deployment pipeline, database, or HTTP service until an independently scalable/failable boundary is actually needed.
7. Rating stays an in-process deterministic domain service. Payments/Ledger stays authoritative for money. Game stays authoritative for legal chess state and clocks.
8. Admin is a privileged orchestration surface, not a second copy of moderation/account/payment logic.

## Ownership

| Module | Owns |
| --- | --- |
| Auth | identities, credentials, profiles, sessions, devices, privacy/social-account entry points |
| Game | authoritative Chess960 rooms, legal moves, clocks, game lifecycle/results, spectators |
| Realtime Gateway | ingress, CORS, route ordering, Worker/DO export composition |
| Matchmaking | presence/queues, public opponent selection, friend-room coordination |
| Tournament Engine | registration, check-in, seeding, pairings, rounds, standings, viewing |
| Rating | Rapid/Blitz/Bullet Glicko-2 calculations and state transitions |
| Payments/Ledger | provider intents, KYC gates, wallets, holds, immutable ledger, fees, payouts/refunds/entitlements |
| Moderation | fair-play policy, reports, blocks, evidence, review cases, competitive/funded review gates |
| Notifications | in-app inbox, preferences, push subscriptions and delivery |
| Admin | privileged operator endpoints that delegate to domain modules |

The existing implementation files remain in `server/src` during this migration. They are treated as private implementation details behind the module facades. Moving code physically can happen incrementally after dependencies are clean; it is not required for logical separation.
