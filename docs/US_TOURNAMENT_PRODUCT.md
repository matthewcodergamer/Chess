# QQURZ Chess — U.S. tournament product blueprint

## Product language

Use tournament language consistently:

- **Tournament entry fee** — the disclosed registration price for a specific event.
- **Guaranteed prize fund** — the amount QQURZ commits to award under the published rules.
- **Prize distribution** — the published amounts/percentages for finishing places or sections.
- **Registration** — a player's entry into the event.
- **Tournament Director (TD)** — the official managing pairings, disputes, fair-play review and results.

Avoid product language such as **bet**, **wager**, **odds**, **stake**, **sportsbook**, **side bet**, or player-vs-player money matching. QQURZ is intended to operate skill-based chess competitions, not a betting market.

## Launch modes

### 1. Free Community Tournament

Ship this first.

- free registration
- Swiss or knockout format
- scheduled rounds
- automatic pairings
- Chess960 position revealed for the round/match
- shared strategy countdown
- server-authoritative clocks and moves
- standings and tiebreaks based only on published chess/tournament rules
- tournament-director controls
- fair-play review queue

### 2. U.S. Prize Tournament

Keep the registration/payment control disabled until all compliance gates are met.

Example product card:

```text
QQURZ Founders Prize Open
U.S. Entry-Fee Skill Tournament
Entry fee: $25
Guaranteed prize fund: $500
No betting, odds, wagering or side stakes.
Eligibility and Official Rules apply.
```

The entry amount and prize amount are separate disclosures. Do not imply that each entrant owns a fractional share of a communal pot, and do not let players change prize exposure through side transactions.

## Registration flow for a future paid event

1. Sign in.
2. Confirm age and legal name.
3. Confirm eligible U.S. state/residency/location requirements defined by the Official Rules.
4. Accept the specific event's Official Rules and fair-play policy.
5. Complete approved payment-provider checkout for the **tournament entry fee**.
6. Receive a registration receipt and event registration ID.
7. Before round one, complete any required identity/fair-play verification.
8. Play on server-authoritative boards.
9. Results enter a TD review/fair-play hold before prizes are finalized.
10. Prize winners complete payout/tax requirements before disbursement.

## Tournament engine

Recommended core entities:

- `User`
- `PlayerProfile`
- `Tournament`
- `TournamentRegistration`
- `TournamentRound`
- `Pairing`
- `GameRoom`
- `GameResult`
- `FairPlayReview`
- `PrizeSchedule`
- `PrizeAward`
- `AuditEvent`

Recommended event states:

```text
DRAFT
REGISTRATION_OPEN
REGISTRATION_CLOSED
CHECK_IN
IN_PROGRESS
FAIR_PLAY_REVIEW
RESULTS_PROVISIONAL
RESULTS_FINAL
PAYOUT_PENDING
CLOSED
CANCELLED
```

Paid-registration state should exist only after the payment/legal launch gate. Until then, tournaments should use `entryFeeCents = 0` and expose no payment endpoint.

## Pairing formats

### Swiss

Best default for larger online events. Players get multiple games rather than being eliminated after one loss. Store each pairing, color assignment, score, tiebreak values and result on the server.

### Knockout

Useful for featured finals. Every match advances one player according to published rules. Avoid random prize-determining tiebreaks; use chess-based playoff/tiebreak procedures defined before the event.

### Arena

Useful for free community events but less ideal for the first U.S. prize launch because scheduling, anti-cheat and equal-opportunity questions are easier to administer in fixed-round events.

## Fair-play / anti-cheat requirements

A serious money-prize chess platform needs more than move legality.

At minimum log:

- every move with server receive time
- think time per move
- disconnect/reconnect events
- browser/app version and non-invasive session integrity signals
- repeated IP/device relationships for abuse review, subject to privacy rules
- unusual engine-correlation signals
- account history and rating movement
- TD decisions and reason codes

Do not automatically accuse a player based on a single engine-match score. Use a documented review process, human escalation for significant sanctions, an appeals/dispute path, and retention rules.

For higher-value events, the product roadmap can add stronger identity verification and proctoring requirements similar to established online cash-prize chess events.

## Official Rules checklist

Before a U.S. paid event opens, the event should publish at least:

- sponsor/operator legal name and contact information
- event dates/times/time zone
- eligibility and excluded jurisdictions
- minimum age
- entry fee and refund/cancellation policy
- maximum/minimum field size if relevant
- guaranteed vs conditional prize amounts
- tournament format and time control
- Chess960 setup-generation method
- tie and playoff procedure
- disconnect/technical-failure procedure
- fair-play and anti-cheat rules
- prohibited assistance and engine use
- disqualification procedure
- prize verification and payout timing
- tax responsibilities/reporting
- privacy/data handling references
- dispute/governing-law language reviewed by counsel

## U.S. compliance gate

A skills-contest model is not the same thing as a sweepstakes or sportsbook, but U.S. state contest law is not uniform. A future paid QQURZ event must be reviewed for the states it serves. Payment providers also apply their own rules independently of whether the event is lawful.

The production gate should require explicit internal approvals such as:

```text
LEGAL_APPROVED=true
PROCESSOR_APPROVED=true
OFFICIAL_RULES_PUBLISHED=true
AGE_IDENTITY_ENABLED=true
FAIR_PLAY_ENABLED=true
TAX_PAYOUT_READY=true
```

The application must default these to false and refuse to expose paid registration unless every required gate is true.

## Industry references

Examples showing the ordinary U.S. chess tournament pattern of separate entry fees and published prize funds:

- US Chess 2026 National Open: https://new.uschess.org/2026-national-open
- US Chess 2026 U.S. Open registration: https://new.uschess.org/us-open-2026/registration
- US Chess 2026 U.S. Open prizes: https://new.uschess.org/us-open-2026/prizes

Consumer/legal/payment references:

- FTC skill-contest guidance: https://consumer.ftc.gov/articles/fake-prize-sweepstakes-and-lottery-scams
- ABA state contest-law overview: https://www.americanbar.org/groups/gpsolo/resources/ereport/archive/sales-promotions-contests-sweepstakes/
- Stripe restricted-business policy: https://stripe.com/legal/restricted-businesses

These sources are useful product/compliance research, not a substitute for legal advice on the final QQURZ structure.
