# QQURZ Competitive Integrity

## Architectural rule

Competitive player pages must not import, initialize, or expose the AI/analysis engine. Stockfish is for local AI practice/analysis only and remains behind a dynamic import boundary. `npm run check:engine-isolation` fails the build if multiplayer or tournament source files reference the engine.

This is a product/build boundary, not a claim that a browser can prevent someone from opening an external chess engine on another device. Detection and enforcement therefore belong on the server/review side.

## Evidence recorded

For each server-authoritative competitive game, the integrity room records:

- complete UCI/SAN move history;
- FEN before and after every committed move;
- server receive/commit timestamps;
- authoritative elapsed/think time and any bounded latency credit;
- client sequence/timestamp as untrusted supporting evidence only;
- engine-free position-complexity features (piece/pawn counts, non-pawn piece count, material imbalance, check state);
- tournament relationship and funded friend-match context;
- account pair history;
- optional pseudonymous device/network signals when policy permits collection.

Raw IP addresses are not persisted by this subsystem. When signal collection is enabled, a coarse network prefix and client traits are HMAC-hashed with a dedicated secret before storage.

## Review policy

Automated triage creates review cases. It does **not** declare a player a cheater and it does not ban users automatically. Triage currently considers relationship/timing/network signals. Future offline engine-correlation jobs may add evidence to a case, but engine agreement alone must not create an automatic adverse action.

Funded cases are higher priority. An adverse-action status for a funded case requires two distinct reviewers. Review notes are retained with the case.

Funded friend-match winnings remain held when the integrity disposition is `manual_review`. Paid tournament settlement also pauses when the tournament has unresolved review cases. Free/casual games are allowed to finish even when the integrity service is unavailable.

## Evidence retention classes

Current metadata classes:

- casual games: `casual_90d`;
- tournament games: `tournament_365d`;
- funded games: `money_730d`.

These classes identify intended retention. A production retention/deletion worker should enforce them before enabling signal collection at scale.

## Cloudflare deployment binding

The Worker needs a Durable Object binding named `INTEGRITY` targeting the exported class `IntegrityReviewRegistry`. The connected repository tool blocked editing `server/wrangler.jsonc`, so this binding must be added in deployment configuration before the integrity registry becomes operational.

Required secrets:

- `INTEGRITY_INTERNAL_SECRET`: random high-entropy secret used only for Worker-to-Durable-Object integrity calls;
- `INTEGRITY_ADMIN_SECRET`: separate random high-entropy secret protecting reviewer/admin endpoints.

Optional privacy-sensitive signal collection:

- `INTEGRITY_SIGNAL_CAPTURE=enabled` only after the applicable privacy/legal policy permits it;
- `INTEGRITY_SIGNAL_SECRET`: separate high-entropy HMAC secret for pseudonymous device/network signals.

Keep signal capture disabled by default.

## Reviewer endpoints

The gateway exposes protected review routes under `/integrity/admin/` after the binding is configured. Requests require `x-integrity-admin` matching `INTEGRITY_ADMIN_SECRET`.

- `GET /integrity/admin/reviews`
- `GET /integrity/admin/reviews?status=queued`
- `GET /integrity/admin/games/<gameId>`
- `POST /integrity/admin/reviews/<caseId>/decision`

Decision body:

```json
{
  "reviewerId": "operator-id",
  "decision": "clear | escalate | action_required",
  "note": "Human review rationale"
}
```

For funded cases, the first `action_required` review moves the case to `second_review`; a second distinct reviewer is required before `action_required` becomes authorized.
