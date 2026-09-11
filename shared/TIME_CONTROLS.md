# QQURZ time-control authority

QQURZ represents a chess clock as a base duration plus an increment. The shared presets are `3+2`, `5+0`, and `10+5`; private/local games may also use validated custom controls. Tournament rooms are constrained by the template attached to the selected tournament.

## Authority rules

- Local play measures elapsed time with the browser's monotonic `performance.now()` clock. Wall-clock changes must not add or remove thinking time.
- Online play never trusts a client clock. The Durable Object stores the remaining time, authoritative interval start, increment, and side that owns the running clock.
- A reconnect is not a pause. The server continues charging the authoritative clock while a player is disconnected and schedules timeout alarms during `RECONNECTING` as well as `ACTIVE`.
- Every accepted online move records `serverReceivedAt` and `serverCommittedAt`, plus the next authoritative clock start. Client timestamps and sequence numbers are correlation/audit data only and never determine remaining time.
- Lag compensation is based only on a fresh server-measured WebSocket RTT sample. It is bounded, uses the minimum observed RTT, and is credited at most once for the authoritative physical clock press that completes a move. Invalid/replayed move traffic cannot farm extra clock time.
- Increment is awarded only by the authoritative `CLOCK_TRANSFERRED` transition after a completed move/clock press.

These rules are part of the shared game-session contract and must not be reimplemented independently by React components.
