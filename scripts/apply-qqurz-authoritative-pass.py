from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected block not found in {path}')
    p.write_text(text.replace(old, new, 1))

# Matchmaking creates both seats and the shared room state in one Durable Object request.
replace('server/src/index.ts', """    if (url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST') {
      if (this.room) return json({ error: 'Room already exists.' }, 409);""", """    if (url.hostname === 'room.internal' && url.pathname === '/match' && request.method === 'POST') {
      if (this.room) return json({ error: 'Room already exists.' }, 409);
      const body = await request.json() as {
        code?: string;
        whiteName?: string;
        whiteAccountId?: string | null;
        blackName?: string;
        blackAccountId?: string | null;
        timeControl?: TimeControlRequest;
        tournamentTemplateId?: TournamentTimeTemplateId;
      };
      const code = String(body.code ?? '').toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: 'Invalid room code.' }, 400);
      const now = Date.now();
      const whiteToken = seatToken();
      const blackToken = seatToken();
      const positionId = randomChess960Id();
      const timeControl = normalizeTimeControl(body.timeControl, '10+5');
      const templateId = body.tournamentTemplateId && TOURNAMENT_TIME_TEMPLATES[body.tournamentTemplateId] ? body.tournamentTemplateId : null;
      if (templateId && !isTournamentControlAllowed(templateId, timeControl)) return json({ error: 'That time control is not allowed by this tournament template.' }, 400);
      const fen = chess960Fen(positionId);
      this.room = {
        code,
        session: createGameSession({ id: `room-${code}`, state: 'LOBBY', positionId, fen, sideToMove: 'white', clockMs: timeControl.baseMs, incrementMs: timeControl.incrementMs, connectionStatus: 'CONNECTED', now }),
        lastMoveTiming: null,
        accountResultRecordedAt: null,
        positionHistory: historyForFen(fen),
        createdAt: now,
        lastActivityAt: now,
        players: {
          white: { name: normalizeName(body.whiteName), token: whiteToken, accountId: body.whiteAccountId ?? null },
          black: { name: normalizeName(body.blackName), token: blackToken, accountId: body.blackAccountId ?? null },
        },
        coin: emptyCoin(),
        auction: emptyAuction(),
        colorAuction: emptyColorAuction(),
      };
      this.prepareCoin(now);
      await this.persist();
      await this.scheduleForState();
      return json({
        white: { code, token: whiteToken, color: 'white' },
        black: { code, token: blackToken, color: 'black' },
      });
    }

    if (url.hostname === 'room.internal' && url.pathname === '/create' && request.method === 'POST') {
      if (this.room) return json({ error: 'Room already exists.' }, 409);""")

replace('server/src/matchmaker.ts', """      const created = await room.fetch(new Request('https://room.internal/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          name: first.name,
          accountId: first.accountId,
          timeControl: first.criteria.timeControl,
        }),
      }));
      if (created.status === 409) continue;
      if (!created.ok) throw new Error('Could not create a matchmaking room.');
      const firstSeat = await created.json() as RoomSeat;

      const joined = await room.fetch(new Request('https://room.internal/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: second.name, accountId: second.accountId }),
      }));
      if (!joined.ok) throw new Error('Could not seat the matched opponent.');
      const secondSeat = await joined.json() as RoomSeat;
      return { first: firstSeat, second: secondSeat };""", """      const created = await room.fetch(new Request('https://room.internal/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          whiteName: first.name,
          whiteAccountId: first.accountId,
          blackName: second.name,
          blackAccountId: second.accountId,
          timeControl: first.criteria.timeControl,
        }),
      }));
      if (created.status === 409) continue;
      if (!created.ok) throw new Error('Could not atomically create the matchmaking game.');
      const seats = await created.json() as { white?: RoomSeat; black?: RoomSeat };
      if (!seats.white || !seats.black) throw new Error('Matchmaking server returned incomplete seats.');
      return { first: seats.white, second: seats.black };""")

# Do not consume a replay key for a move the authoritative room rejected.
replace('server/src/authoritativeRoom.ts', """    await ctx.storage.put(storageKey, [...recent, replayKey].slice(-REPLAY_CACHE_LIMIT));

    // A legacy room can contain a pending physical-clock transfer.""", """    // A legacy room can contain a pending physical-clock transfer.""")
replace('server/src/authoritativeRoom.ts', """    if (afterMoveNumber === beforeMoveNumber) {
      this.canonicalSnapshot(ws, token);
      return;
    }

    this.autoTransferClockAfterMove();""", """    if (afterMoveNumber === beforeMoveNumber) {
      this.canonicalSnapshot(ws, token);
      return;
    }

    await ctx.storage.put(storageKey, [...recent, replayKey].slice(-REPLAY_CACHE_LIMIT));
    this.autoTransferClockAfterMove();""")

Path('docs/MULTIPLAYER_CAPACITY.md').write_text('''# QQURZ Multiplayer Capacity\n\nQQURZ keeps one authoritative Durable Object per game and a separate matchmaking lobby actor. Measure before changing Cloudflare capacity.\n\nTrack concurrent WebSockets, messages/second, queue depth, active games, broadcast fan-out, Durable Object CPU/storage latency, API p95/p99, reconnect rate, duplicate commands, and failed room allocations.\n\nScaling order:\n\n1. Keep each chess match isolated in its own Durable Object.\n2. Measure the shared matchmaking actor.\n3. Shard matchmaking by compatible region/time-control buckets if the lobby becomes the hot actor.\n4. Keep static frontend/API traffic separate from realtime WebSockets.\n5. Only change Cloudflare plan/resources after metrics show a real account, CPU, request, or storage limit.\n\nCloudflare documents Durable Objects as independently scalable actors and recommends hibernatable WebSockets for long-lived realtime connections. The hibernation API permits up to 32,768 WebSocket connections per Durable Object, while CPU/memory/workload can be the practical limit.\n''')

Path('tests/unit/multiplayer-pass.test.ts').write_text('''import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\n\ntest('public matchmaking uses one atomic room allocation', () => {\n  const matchmaker = readFileSync('server/src/matchmaker.ts', 'utf8');\n  const room = readFileSync('server/src/index.ts', 'utf8');\n  assert.match(matchmaker, /room\\.internal\\/match/);\n  assert.match(room, /url\\.pathname === '\\/match'/);\n});\n\ntest('public online arena contains no physical clock or slap UI', () => {\n  const arena = readFileSync('src/multiplayer/OnlineArena.tsx', 'utf8');\n  assert.doesNotMatch(arena, /PhysicalChessClock/);\n  assert.doesNotMatch(arena, /clock-slap-inline/);\n  assert.doesNotMatch(arena, /press your clock/i);\n});\n\ntest('public frontend source contains no 20 percent fee string', () => {\n  const arena = readFileSync('src/multiplayer/OnlineArena.tsx', 'utf8');\n  const launch = readFileSync('src/styles/launch-fixes.css', 'utf8');\n  assert.doesNotMatch(`${arena}\\n${launch}`, /20\\s*%/);\n});\n''')
