# QQURZ Fair-Play Operations

## Player policy

Competitive participation uses policy version `2026-09-12.v1`. Ordinary account creation, local play and AI practice do not require acceptance. The current policy is intentionally concise:

1. Play competitive games yourself. No engine, AI, outside move suggestion or another person choosing moves.
2. Use one competitive account. No collusion, boosting, intentional rating loss or result manipulation.
3. Play at a reasonable pace. Do not intentionally stall, repeatedly abandon games or abuse disconnects.
4. Reports and automated signals are evidence for review, not automatic findings.
5. Funded games/prizes may be held for manual fair-play review.

Acceptance is stored server-side with account ID, policy version and timestamp. A future material policy revision should use a new version so competitive entry requires renewed acceptance.

## Competitive entry gates

The current policy is checked before public matchmaking and tournament registration/check-in. Signed-in online room creation/join also verifies acceptance in the room Durable Object. Free/local/AI play remains independent.

## Disconnects and abandonment

A disconnect is not itself a fair-play violation. The authoritative room enters reconnecting state and the server-owned clock/result rules continue to apply.

Operational signals are based on patterns rather than a single network event:

- repeated timeout losses,
- repeated timeout losses with reconnect activity,
- repeated zero/very-low-move losses,
- repeated explicit early abandons,
- repeated long final inactivity periods before timeout.

The room supports an explicit `abandon` command as a resignation-equivalent result. Silent browser/network loss is treated as a disconnect, not an abandonment declaration.

## Stalling and sandbagging review

Current automated triage is deliberately conservative. Recent-game counters can queue review when patterns repeat. A possible sandbagging case can be created when a mature competitive account shows a high concentration of short/timeout/abandon losses. This is **not** proof of intent and must be compared with rating history, opponent strength, network evidence, tournament relationships and full game records before a moderator takes action.

Do not create a penalty solely because a heuristic threshold fired.

## Multiple-account review

When privacy-permitted integrity signal collection is enabled, device/network data is stored as pseudonymous hashes rather than raw IPs. A device signal appearing across several competitive accounts or a network-prefix signal appearing across many accounts can queue a review.

Shared devices, schools, families, clubs, VPNs, carrier NAT and public networks can create legitimate overlap. Network evidence is weak corroboration. A shared signal must never be treated as identity proof by itself.

## Player reports

Reports are tied to an authoritative room and the backend resolves the opponent account from the room seats. The browser does not choose the target account ID.

Supported categories:

- possible engine/outside assistance,
- intentional stalling,
- disconnect/abandon abuse,
- possible sandbagging/rating manipulation,
- possible multiple-account abuse,
- harassment/abuse,
- other fair-play concern.

Reports are deduplicated by reporter/target/game/category and enter the moderator evidence queue. Multiple independent reports can raise review context but do not automatically convict an account.

## Blocking

Competitive blocking is stored in the fair-play service. A direct competitive room join is rejected when either participant has blocked the other. Existing account/profile blocking remains separate from this server-side competitive relation.

## Moderator API

All moderator endpoints require `x-integrity-admin` matching `INTEGRITY_ADMIN_SECRET`.

- `GET /integrity/admin/fair-play/reports`
- `GET /integrity/admin/fair-play/cases`
- `GET /integrity/admin/fair-play/players/:accountId`
- `POST /integrity/admin/fair-play/cases/:caseId/decision`

Decision body:

```json
{
  "reviewerId": "moderator-id",
  "decision": "clear | escalate | action_required",
  "note": "Evidence-based moderator note"
}
```

Funded cases require two distinct reviewers before `action_required` can be reached. Moderators should record what evidence was reviewed, why alternative explanations were accepted/rejected, and what action is authorized outside the evidence store.

## Money events

Open fair-play cases tied to funded games can keep settlement in `manual_review`. Tournament-level open cases can likewise pause prize distribution. Review holds are operational safeguards, not public accusations.

## Privacy and retention

Only collect optional device/network integrity signals when the operator has an appropriate privacy/legal basis and the integrity signal switch is explicitly enabled. Raw IP addresses should not be persisted in the integrity evidence store. Follow the existing integrity retention classes and implement deletion/retention jobs before treating those metadata classes as an enforced retention schedule.

## Moderator checklist

Before adverse action:

1. Read the full move/timing evidence and result context.
2. Check disconnect/reconnect and no-move/timeout history.
3. Check player reports for independence and specificity.
4. Review rating trajectory and opponent strength before calling something sandbagging.
5. Treat shared device/network indicators as corroboration only.
6. Check tournament/repeated-opponent relationships for collusion context.
7. For funded cases, obtain the required second reviewer.
8. Record a concise evidence-based note.
9. Use `clear` when the evidence has a reasonable benign explanation; use `escalate` when more investigation is needed.
