import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function update(relativePath, transforms) {
  const file = path.join(root, relativePath);
  let source = fs.readFileSync(file, 'utf8');
  for (const [before, after, label] of transforms) {
    if (!source.includes(before)) throw new Error(`${relativePath}: missing migration anchor: ${label}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source);
}

update('server/src/index.ts', [
  [
    "import { adjudicateChess, appendPositionHistory, chessPositionKeyFromFen } from '../../shared/chess960Rules';",
    "import { adjudicateChess, appendPositionHistory, chessPositionKeyFromFen } from '../../shared/chess960Rules';\nimport { recordAccountGame, resolveAccountSession, type AccountEnv } from './accounts';",
    'account imports',
  ],
  [
    "type PlayerSeat = { name: string; token: string };",
    "type PlayerSeat = { name: string; token: string; accountId: string | null };",
    'player account id',
  ],
  [
    "  lastMoveTiming: MoveTiming | null;\n  positionHistory: string[];",
    "  lastMoveTiming: MoveTiming | null;\n  accountResultRecordedAt: number | null;\n  positionHistory: string[];",
    'room account result flag',
  ],
  [
    "type Env = {\n  ROOMS: DurableObjectNamespace<ChessRoom>;",
    "type Env = AccountEnv & {\n  ROOMS: DurableObjectNamespace<ChessRoom>;",
    'account env',
  ],
  [
    "  if (legacy.session) {\n    const room = legacy as RoomState;\n    if (!Array.isArray(room.positionHistory) || !room.positionHistory.length) room.positionHistory = historyForFen(room.session.fen);\n    return room;\n  }",
    "  if (legacy.session) {\n    const room = legacy as RoomState;\n    if (!Array.isArray(room.positionHistory) || !room.positionHistory.length) room.positionHistory = historyForFen(room.session.fen);\n    if (room.players?.white && !('accountId' in room.players.white)) room.players.white.accountId = null;\n    if (room.players?.black && !('accountId' in room.players.black)) room.players.black.accountId = null;\n    if (typeof room.accountResultRecordedAt !== 'number') room.accountResultRecordedAt = null;\n    return room;\n  }",
    'stored room migration',
  ],
  [
    "    code: String(legacy.code), session, lastMoveTiming: legacy.lastMoveTiming ?? null,\n    positionHistory: historyForFen(session.fen),\n    createdAt: Number(legacy.createdAt ?? now), lastActivityAt: Number(legacy.lastActivityAt ?? now),\n    players: legacy.players, coin: legacy.coin ?? emptyCoin(), auction: legacy.auction ?? emptyAuction(), colorAuction: legacy.colorAuction ?? emptyColorAuction(),",
    "    code: String(legacy.code), session, lastMoveTiming: legacy.lastMoveTiming ?? null, accountResultRecordedAt: null,\n    positionHistory: historyForFen(session.fen),\n    createdAt: Number(legacy.createdAt ?? now), lastActivityAt: Number(legacy.lastActivityAt ?? now),\n    players: {\n      white: { ...legacy.players.white, accountId: legacy.players.white.accountId ?? null },\n      black: legacy.players.black ? { ...legacy.players.black, accountId: legacy.players.black.accountId ?? null } : null,\n    }, coin: legacy.coin ?? emptyCoin(), auction: legacy.auction ?? emptyAuction(), colorAuction: legacy.colorAuction ?? emptyColorAuction(),",
    'legacy room account migration',
  ],
  [
    "      const body = await request.json().catch(() => ({})) as Record<string, unknown>;\n      const name = normalizeName(body.name);\n      for (let attempt = 0; attempt < 12; attempt += 1) {\n        const code = roomCode(); const stub = env.ROOMS.get(env.ROOMS.idFromName(code));\n        const internal = await stub.fetch(new Request('https://room.internal/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name, timeControl: body.timeControl, tournamentTemplateId: body.tournamentTemplateId }) }));",
    "      const body = await request.json().catch(() => ({})) as Record<string, unknown>;\n      const identity = await resolveAccountSession(request, env);\n      const name = identity?.displayName ?? normalizeName(body.name);\n      for (let attempt = 0; attempt < 12; attempt += 1) {\n        const code = roomCode(); const stub = env.ROOMS.get(env.ROOMS.idFromName(code));\n        const internal = await stub.fetch(new Request('https://room.internal/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name, accountId: identity?.id ?? null, timeControl: body.timeControl, tournamentTemplateId: body.tournamentTemplateId }) }));",
    'authenticated room create',
  ],
  [
    "      const body = await request.json().catch(() => ({})) as Record<string, unknown>;\n      const internal = await stub.fetch(new Request('https://room.internal/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: normalizeName(body.name) }) }));",
    "      const body = await request.json().catch(() => ({})) as Record<string, unknown>;\n      const identity = await resolveAccountSession(request, env);\n      const name = identity?.displayName ?? normalizeName(body.name);\n      const internal = await stub.fetch(new Request('https://room.internal/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, accountId: identity?.id ?? null }) }));",
    'authenticated room join',
  ],
  [
    "      const body = await request.json() as { code?: string; name?: string; timeControl?: TimeControlRequest; tournamentTemplateId?: TournamentTimeTemplateId };",
    "      const body = await request.json() as { code?: string; name?: string; accountId?: string | null; timeControl?: TimeControlRequest; tournamentTemplateId?: TournamentTimeTemplateId };",
    'internal create account type',
  ],
  [
    "        lastMoveTiming: null,\n        positionHistory: historyForFen(chess960Fen(positionId)),\n        createdAt: now, lastActivityAt: now,\n        players: { white: { name: normalizeName(body.name), token }, black: null }, coin: emptyCoin(), auction: emptyAuction(), colorAuction: emptyColorAuction(),",
    "        lastMoveTiming: null,\n        accountResultRecordedAt: null,\n        positionHistory: historyForFen(chess960Fen(positionId)),\n        createdAt: now, lastActivityAt: now,\n        players: { white: { name: normalizeName(body.name), token, accountId: body.accountId ?? null }, black: null }, coin: emptyCoin(), auction: emptyAuction(), colorAuction: emptyColorAuction(),",
    'room creator account storage',
  ],
  [
    "      const body = await request.json() as { name?: string }; const token = seatToken();\n      this.room.players.black = { name: normalizeName(body.name), token };",
    "      const body = await request.json() as { name?: string; accountId?: string | null }; const token = seatToken();\n      this.room.players.black = { name: normalizeName(body.name), token, accountId: body.accountId ?? null };",
    'room joiner account storage',
  ],
  [
    "  private async persist(): Promise<void> { if (this.room) await this.ctx.storage.put('room', this.room); }",
    `  private async persist(): Promise<void> {\n    if (!this.room) return;\n    await this.ctx.storage.put('room', this.room);\n    if (!isTerminalGameState(this.room.session.state) || !this.room.session.result || this.room.accountResultRecordedAt) return;\n    const black = this.room.players.black;\n    if (!black) return;\n    try {\n      await recordAccountGame(this.env, {\n        id: \`room:\${this.room.code}:\${this.room.createdAt}\`,\n        roomCode: this.room.code,\n        playedAt: this.room.session.finalizedAt ?? this.room.session.updatedAt ?? Date.now(),\n        white: { accountId: this.room.players.white.accountId, name: this.room.players.white.name },\n        black: { accountId: black.accountId, name: black.name },\n        winner: this.room.session.winner,\n        result: this.room.session.result,\n        resultKind: this.room.session.resultKind,\n        positionId: this.room.session.positionId,\n        baseMs: this.room.session.clocks.baseMs,\n        incrementMs: this.room.session.clocks.incrementMs,\n        moveCount: this.room.session.moveNumber,\n      });\n      this.room.accountResultRecordedAt = Date.now();\n      await this.ctx.storage.put('room', this.room);\n    } catch {\n      // Account history is supplemental; never block the authoritative chess room from persisting.\n    }\n  }`,
    'terminal account result persistence',
  ],
]);

update('server/src/tournaments.ts', [
  [
    "import { TIME_CONTROL_PRESETS, tournamentTimeTemplateFor, type TournamentTimeTemplateId } from '../../shared/timeControl';",
    "import { TIME_CONTROL_PRESETS, tournamentTimeTemplateFor, type TournamentTimeTemplateId } from '../../shared/timeControl';\nimport { recordAccountTournament, resolveAccountSession, type AccountEnv } from './accounts';",
    'tournament account imports',
  ],
  [
    "export type TournamentEnv = {",
    "export type TournamentEnv = AccountEnv & {",
    'tournament account env',
  ],
  [
    "type Registration = { registrationId: string; sessionId: string; playerName: string; createdAt: number };",
    "type Registration = { registrationId: string; sessionId: string; playerName: string; accountId: string | null; createdAt: number; placement: number | null };",
    'tournament account registration type',
  ],
  [
    "  const body = await request.json().catch(() => ({})) as { sessionId?: string; playerName?: string };\n  const sessionId = String(body.sessionId ?? '').trim();\n  try {",
    "  const body = await request.json().catch(() => ({})) as { sessionId?: string; playerName?: string };\n  const sessionId = String(body.sessionId ?? '').trim();\n  const identity = await resolveAccountSession(request, env);\n  try {",
    'resolve tournament account',
  ],
  [
    "      body: JSON.stringify({ eventId, sessionId, playerName: normalizePlayerName(body.playerName) }),\n    }));\n    return new Response(internal.body, { status: internal.status, headers: internal.headers });",
    "      body: JSON.stringify({ eventId, sessionId, playerName: identity?.displayName ?? normalizePlayerName(body.playerName), accountId: identity?.id ?? null }),\n    }));\n    if (internal.ok && identity) {\n      await recordAccountTournament(env, { accountId: identity.id, tournamentId: event.id, name: event.name, registeredAt: Date.now(), status: 'registered' });\n    }\n    return new Response(internal.body, { status: internal.status, headers: internal.headers });",
    'record tournament account history',
  ],
  [
    "      const body = await request.json().catch(() => ({})) as { eventId?: string; sessionId?: string; playerName?: string };",
    "      const body = await request.json().catch(() => ({})) as { eventId?: string; sessionId?: string; playerName?: string; accountId?: string | null };",
    'tournament claim account type',
  ],
  [
    "        playerName: normalizePlayerName(body.playerName),\n        createdAt: Date.now(),",
    "        playerName: normalizePlayerName(body.playerName),\n        accountId: body.accountId ?? null,\n        createdAt: Date.now(),\n        placement: null,",
    'store tournament account id',
  ],
]);

console.log('QQURZ account integration migration applied to rooms and tournament registration.');
