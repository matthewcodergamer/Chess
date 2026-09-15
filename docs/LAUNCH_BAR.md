# QQURZ Launch Bar

QQURZ is **not finished** because a build succeeds, a screen looks polished, or a feature exists in isolation. The product may be called launch-ready only when the complete core launch bar below is demonstrated end to end. Paid events have a second, stricter launch bar and remain disabled until that separate bar is satisfied.

## Release states

Use these terms consistently:

- **Development** — normal implementation work; incomplete flows are expected.
- **Core launch candidate** — every core launch requirement is implemented and the full release gate is being verified.
- **Core launch-ready** — every core launch requirement has passing evidence on the target device and in CI.
- **Paid-events launch candidate** — core launch-ready plus all money/compliance requirements implemented in an approved production environment.
- **Paid-events launch-ready** — the paid-events bar has independent technical, operational, legal/compliance and payout sign-off.

Do not use **finished**, **production-ready**, **launch-ready**, or equivalent language for the whole product when any applicable launch requirement is unresolved.

## Core launch bar

Every item in this section is mandatory for the free/core product.

### 1. First-run comprehension

A brand-new player must be able to open QQURZ with no explanation from another person and understand the next action.

Acceptance evidence:

- cold start reaches a usable first-run or home surface without a broken/blank intermediate state;
- onboarding explains only what is needed to begin playing;
- the player can identify Tournament, Play a Friend, Same Device and account/profile entry points without hunting through unrelated menus;
- primary actions use the shared design system and remain obvious in dark and light mode;
- no test catalog, developer-only control, placeholder copy, fake server data or debug state appears in the normal player journey.

### 2. Account creation and recovery-safe identity

A new player must be able to create/sign in to an account and return to the same identity later.

Acceptance evidence:

- create-account/sign-in flow completes without an operator editing storage manually;
- account identity survives reload/restart according to the documented session policy;
- duplicate submissions and interrupted requests do not create duplicate accounts or corrupt the active session;
- account/profile surfaces clearly distinguish local-only profile data from authenticated server identity;
- failure states explain what happened and provide a valid recovery action.

### 3. Game choice

From the normal navigation, the player must be able to choose and enter:

- a tournament flow;
- a friend/private-room flow;
- a same-device local game;
- AI practice may remain a secondary practice path and must not displace the three primary play choices.

No mode may invent its own unrelated visual language or separate chess rules implementation.

### 4. Complete Chess960 game fidelity

A player must be able to play a complete Chess960 game from setup to a final recorded result.

Acceptance evidence:

- legal Chess960 setup/FEN and castling are validated through the shared rules path;
- legal move validation, promotion, en passant, check, checkmate and draw adjudication use the canonical rules implementation rather than screen-specific logic;
- a game can finish by the supported terminal results without leaving the UI in an ambiguous active state;
- move history, final FEN/result and clocks agree with the canonical session state;
- local 2D, AI, online, tournament and Premium 3D presentations do not produce different results for the same canonical move sequence.

### 5. Clock correctness

Clocks are part of game state, not decoration.

Acceptance evidence:

- base time and increment are taken from the shared time-control model;
- only the correct side's clock runs;
- move/clock transfer ordering cannot award an increment twice or skip it;
- timeout creates one final authoritative result;
- reconnect does not manufacture, reset or duplicate time;
- online competitive clocks remain server-authoritative;
- visible 2D and 3D clock presentations agree with the same underlying clock values.

### 6. Disconnect and reconnect integrity

A network interruption must not corrupt a match.

Acceptance evidence:

- disconnect during pre-game, active play and near clock expiry has defined behavior;
- reconnect restores the same room, seat, position, move history, result and authoritative clocks;
- duplicate/replayed client messages do not create duplicate moves or clock transfers;
- stale client state loses to the authoritative server snapshot;
- a completed game cannot be reopened as active because of reconnect timing;
- automated integration/E2E coverage exercises reconnect, and a physical iPhone network-interruption pass is recorded before launch.

### 7. History and rating after play

After a competitive game, the player must be able to see what happened.

Acceptance evidence:

- one finalized game produces one durable history record;
- history identifies opponent, result, Chess960 position/context, time control and completion time;
- rating change is visible after a rated result and is not applied twice on retry/reconnect;
- abandoned, cancelled, unrated and rated games are distinguishable;
- the profile/history surface still works after refresh and a new sign-in session.

### 8. Accessibility and display resilience

The entire player journey must remain usable at large text size.

Acceptance evidence:

- no clipped text, hidden controls, overlapping cards, unreachable actions or horizontal page overflow at supported large/extra text scales;
- every primary flow is keyboard/focus reachable where applicable;
- touch targets use the shared control-size system;
- dark and light themes preserve readable contrast and chess-piece visibility;
- reduced-motion mode does not block progress or hide state;
- mobile safe areas are respected.

### 9. iPhone 11-class smoothness

The iPhone 11-class experience is the primary mobile performance target. The numerical budgets live in `docs/PERFORMANCE_BUDGETS.md` and are part of this launch bar.

At minimum:

- standard 2D meets the documented bundle and runtime budgets;
- Chessground becomes interactive without waiting for Stockfish, account, tournament or Premium 3D bundles;
- navigation, board interaction and clocks remain responsive during a complete game;
- page transitions do not flash harsh loading blocks;
- no sustained runaway animation/render loop burns CPU while a screen is idle or hidden;
- a physical iPhone 11-class Safari pass is required in addition to emulated Playwright viewports.

### 10. Core release evidence

A core launch candidate is not promoted until all of the following are green for the same release commit:

- frontend TypeScript and lint;
- backend TypeScript/architecture checks;
- unit and integration tests;
- production build and bundle budgets;
- mobile/desktop E2E;
- canonical visual regression matrix;
- large-text/mobile overlap audit;
- account creation/sign-in journey;
- complete Chess960 game journey;
- reconnect journey;
- history/rating verification;
- dark/light/reduced-motion passes;
- physical iPhone 11-class smoke and full-game pass.

A passing subset is not equivalent to launch readiness.

## Paid-events launch bar

Real-money tournament entry stays disabled until the **core launch bar** passes and every item below is independently complete.

### Ledger integrity

- every money movement is represented by an auditable immutable/idempotent ledger event;
- balance derivation can be reconciled from ledger history rather than trusting a mutable displayed balance;
- duplicate requests, retries and delayed callbacks cannot double-credit, double-debit or double-pay;
- tournament entry, hold, release, refund, fee and payout states are traceable to account/event/payment identifiers;
- reconciliation jobs detect divergence and fail closed.

### Refunds and event failure

- cancellation/refund policy is documented and implemented;
- failed registration after payment has a deterministic compensation/refund path;
- tournament cancellation, voided entry and operational failure paths are tested;
- refunds are idempotent and visible to support staff;
- no player is told money was returned until the payment provider/ledger state supports that claim.

### Webhook recovery and reconciliation

- payment webhooks are authenticated, idempotent and replay-safe;
- duplicate, delayed and out-of-order delivery is tested;
- lost processing can be recovered by replay/reconciliation without duplicate financial effects;
- operator runbooks cover provider outage, stuck checkout, refund failure and reconciliation mismatch;
- webhook processing never treats the browser redirect as proof of payment.

### Legal/compliance review

Before enabling real-money events, obtain documented review for the jurisdictions actually offered, including the final product model, Official Rules, age/identity requirements, eligibility/geofencing requirements where applicable, tax/payout obligations, privacy/retention, sanctions/payment restrictions and the payment provider's explicit approval of the final use case.

Engineering controls do not substitute for legal/compliance review.

### Anti-cheat and moderation operations

- funded games use the competitive-integrity evidence path in `docs/COMPETITIVE_INTEGRITY.md`;
- player policy, reports, manual review, disconnect/abandon handling and funded-review holds follow `docs/FAIR_PLAY_OPERATIONS.md`;
- adverse actions are reviewable and operationally auditable;
- unresolved funded integrity cases can block settlement;
- retention/deletion jobs and required production bindings/secrets are actually deployed, not merely documented.

### Support procedures

Support must have tested procedures for:

- account access/recovery;
- failed or duplicated checkout reports;
- tournament cancellation and refund status;
- payment dispute/chargeback escalation;
- missing/held payout investigation;
- fair-play review escalation;
- service outage/status communication;
- incident handoff and audit trail preservation.

### Verified payouts

- payout eligibility is derived from authoritative tournament result, ledger state and integrity disposition;
- payout creation is idempotent;
- sandbox payout paths pass first;
- controlled production verification is completed before general paid-event availability;
- payout failures remain recoverable without generating a second payout;
- support/admin tooling can show the exact payout state without editing balances manually.

No real-money tournament should be enabled because checkout alone works.

## Development order

This is the default implementation order. A later phase may be prototyped early, but it must not destabilize or replace the required foundation of an earlier phase.

1. **Design System** — tokens, typography, controls, icon language, responsive rules, accessibility primitives.
2. **Home / Navigation** — first-run clarity, app shell, stable routing, display settings.
3. **2D Game Fidelity** — shared board renderer, player bars, captured pieces, promotion/result UI.
4. **Chess960 Rules / Clock** — canonical rules, lifecycle, clocks, result transitions, time controls.
5. **Accounts** — identity, sessions, profile, recovery-safe error handling.
6. **Realtime Friend Games** — authoritative rooms, private invites, synchronized state.
7. **Matchmaking** — queue criteria, pairing, room handoff, cancellation/retry.
8. **Ratings / History** — durable records, idempotent rating application, player-visible history.
9. **Tournament Engine** — registration, check-in, pairings/brackets, advancement, standings/results.
10. **Reconnect / Spectating** — resilient resync, reconnect semantics, read-only spectator projection.
11. **Anti-cheat / Moderation** — evidence, reports, review queues, holds and operations.
12. **Stripe / Ledger** — payment-provider integration, ledger, webhook reconciliation, refunds.
13. **Paid Tournaments** — only after the paid-events launch requirements can be satisfied.
14. **Premium 3D** — presentation layer over the canonical game state; never a second rules engine.
15. **Admin / Analytics** — operational visibility without privileged manual state corruption.
16. **Performance / Accessibility / QA** — hardening across devices, text scales, themes, budgets and regression suites.
17. **Launch** — promote only after the applicable launch bar is fully evidenced.

## Architectural invariant: one chess state model, many presentations

This rule is permanent:

> **QQURZ has one canonical chess/game state model. Every screen is a presentation or controller around that model, never a new chess implementation.**

Current ownership is intended to be:

- `shared/gameSession.ts` — lifecycle, clocks, connection state and result transitions;
- `shared/chess960Rules.ts` — shared Chess960 adjudication/history helpers;
- `shared/timeControl.ts` — canonical time-control definitions/policy;
- `src/game/useGameSession.ts` — React adapter for the shared session reducer;
- `src/game/useLocalGameController.ts` — local/AI controller using the shared session/rules model; Stockfish chooses a move but does not own game state;
- `server/src/index.ts` — authoritative online room controller using the same shared session/rules model;
- `src/ui/ChessBoardSurface.tsx` — shared 2D board presentation;
- `src/ui/HomeBoardPreview.tsx` — read-only preview of canonical Chess960 state through the shared board surface;
- `src/multiplayer/OnlineArena.tsx` — player presentation of authoritative room snapshots, not a second authoritative game model;
- tournament matches — normal authoritative game sessions associated with tournament metadata, not a tournament-specific chess implementation;
- spectator UI — read-only projection of authoritative game state;
- Premium 3D — alternate renderer/input presentation over the same controller/session state.

### Prohibited architecture

Do not introduce:

- a second move-legality implementation inside a React screen;
- a second clock/result state machine for 3D, tournaments, spectators or homepage previews;
- client-authoritative online results/clocks;
- AI-owned game state;
- tournament-only chess rules that diverge from normal authoritative rooms;
- a spectator model that can mutate the match;
- duplicated FEN/move/result truth just to satisfy a presentation.

When a presentation needs extra data, add a view-model/projection derived from the canonical session rather than forking the chess state.

## Related operational documents

- `docs/PERFORMANCE_BUDGETS.md`
- `docs/VISUAL_REGRESSION.md`
- `docs/MOBILE_OVERLAP_RELEASE_AUDIT.md`
- `docs/DOMAIN_AND_MULTIPLAYER.md`
- `docs/COMPETITIVE_INTEGRITY.md`
- `docs/FAIR_PLAY_OPERATIONS.md`
- `docs/US_TOURNAMENT_PRODUCT.md`
- `docs/DEPLOYMENT_ENVIRONMENTS.md`
- `docs/DEPLOYMENT_CHECKLIST.md`
- `docs/RECOVERY_RUNBOOK.md`

Those documents provide subsystem detail. This launch bar is the top-level release contract.