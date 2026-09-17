# QQURZ Multiplayer Capacity

QQURZ keeps one authoritative Durable Object per game and a separate matchmaking lobby actor. Measure before changing Cloudflare capacity.

## Realtime contract

- The room Durable Object owns Chess960 state, legal move validation, clocks, increments, timeout resolution, connection state, and move history.
- A successful WebSocket upgrade immediately receives the persisted canonical snapshot. The client does not invent a second sync protocol or reset a browser timer.
- Foreground/background recovery creates a fresh WebSocket session and waits for the authoritative snapshot before declaring the game restored.
- Client clock values are interpolated from the last server snapshot timestamp; the browser is presentation only.
- Matchmaking allocates both player seats through one room Durable Object request, so public matching does not expose a create-room/manual-join step.
- Friend rooms remain persistent invite rooms and reconnect to the same room code and seat token.

## What to measure

Track concurrent WebSockets, messages/second, queue depth, active games, broadcast fan-out, Durable Object CPU/storage latency, API p95/p99, reconnect rate, duplicate commands, and failed room allocations.

## Scaling order

1. Keep each chess match isolated in its own Durable Object.
2. Measure the shared matchmaking actor.
3. Shard matchmaking by compatible region/time-control buckets if the lobby becomes the hot actor.
4. Keep static frontend/API traffic separate from realtime WebSockets.
5. Only change Cloudflare plan/resources after metrics show a real account, CPU, request, or storage limit.

Cloudflare documents Durable Objects as independently scalable actors and recommends hibernatable WebSockets for long-lived realtime connections. The hibernation API permits up to 32,768 WebSocket connections per Durable Object, while CPU/memory/workload can be the practical limit. Cloudflare also recommends designing around the logical coordination unit and sharding across objects when a single object becomes a bottleneck.
