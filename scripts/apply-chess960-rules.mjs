import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, transforms) {
  let content = await readFile(path, 'utf8');
  for (const [search, replacement] of transforms) {
    if (!content.includes(search)) {
      if (content.includes(replacement)) continue;
      throw new Error(`Could not find expected text in ${path}: ${search.slice(0, 120)}`);
    }
    content = content.replace(search, replacement);
  }
  await writeFile(path, content);
}

await patch('server/src/index.ts', [
  [
    "import { TOURNAMENT_TIME_TEMPLATES, isTournamentControlAllowed, normalizeTimeControl, type TimeControlRequest, type TournamentTimeTemplateId } from '../../shared/timeControl';",
    "import { TOURNAMENT_TIME_TEMPLATES, isTournamentControlAllowed, normalizeTimeControl, type TimeControlRequest, type TournamentTimeTemplateId } from '../../shared/timeControl';\nimport { adjudicateChess, appendPositionHistory, chessPositionKeyFromFen } from '../../shared/chess960Rules';",
  ],
  [
    "  lastMoveTiming: MoveTiming | null;\n  createdAt: number;",
    "  lastMoveTiming: MoveTiming | null;\n  positionHistory: string[];\n  createdAt: number;",
  ],
  [
    "  if (legacy.session) return legacy as RoomState;",
    "  if (legacy.session) {\n    const room = legacy as RoomState;\n    if (!Array.isArray(room.positionHistory) || !room.positionHistory.length) room.positionHistory = historyForFen(room.session.fen);\n    return room;\n  }",
  ],
  [
    "    code: String(legacy.code), session, lastMoveTiming: legacy.lastMoveTiming ?? null,\n    createdAt: Number(legacy.createdAt ?? now), lastActivityAt: Number(legacy.lastActivityAt ?? now),",
    "    code: String(legacy.code), session, lastMoveTiming: legacy.lastMoveTiming ?? null,\n    positionHistory: historyForFen(session.fen),\n    createdAt: Number(legacy.createdAt ?? now), lastActivityAt: Number(legacy.lastActivityAt ?? now),",
  ],
  [
    "function resultInfo(position: Chess): { kind: GameResultKind; text: string; winner: Color | null } | null {\n  if (position.isCheckmate()) {\n    const winner: Color = position.turn === 'white' ? 'black' : 'white';\n    return { kind: 'CHECKMATE', text: `${winner === 'white' ? 'White' : 'Black'} wins by checkmate`, winner };\n  }\n  if (position.isStalemate()) return { kind: 'DRAW', text: 'Draw by stalemate', winner: null };\n  if (position.isInsufficientMaterial()) return { kind: 'DRAW', text: 'Draw by insufficient material', winner: null };\n  return position.isEnd() ? { kind: 'DRAW', text: 'Game over', winner: null } : null;\n}",
    "function historyForFen(fen: string): string[] {\n  try { return [chessPositionKeyFromFen(fen)]; } catch { return []; }\n}\nfunction resultInfo(position: Chess, history: readonly string[]): { kind: GameResultKind; text: string; winner: Color | null } | null {\n  return adjudicateChess(position, history);\n}",
  ],
  [
    "        lastMoveTiming: null,\n        createdAt: now, lastActivityAt: now,",
    "        lastMoveTiming: null,\n        positionHistory: historyForFen(chess960Fen(positionId)),\n        createdAt: now, lastActivityAt: now,",
  ],
  [
    "    this.room.lastMoveTiming = null;\n  }\n  private startPlaying",
    "    this.room.lastMoveTiming = null;\n    this.room.positionHistory = historyForFen(this.room.session.fen);\n  }\n  private startPlaying",
  ],
  [
    "    const san = makeSan(position, move); position.play(move);\n    this.room.session = reduceGameSession(this.room.session, {",
    "    const san = makeSan(position, move); position.play(move);\n    this.room.positionHistory = appendPositionHistory(this.room.positionHistory, position);\n    this.room.session = reduceGameSession(this.room.session, {",
  ],
  [
    "    const ending = resultInfo(position);",
    "    const ending = resultInfo(position, this.room.positionHistory);",
  ],
]);

await patch('src/LocalGame.tsx', [
  [
    "import { TIME_CONTROL_PRESETS, type TimeControl } from '../shared/timeControl';",
    "import { TIME_CONTROL_PRESETS, type TimeControl } from '../shared/timeControl';\nimport { adjudicateChess, appendPositionHistory, chessPositionKey } from '../shared/chess960Rules';",
  ],
  [
    "function gameResult(pos: Chess): { kind: GameResultKind; text: string; winner: Color | null } | null {\n  if (pos.isCheckmate()) {\n    const winner = pos.turn === 'white' ? 'black' : 'white';\n    return { kind: 'CHECKMATE', text: `${winner === 'white' ? 'White' : 'Black'} wins by checkmate`, winner };\n  }\n  if (pos.isStalemate()) return { kind: 'DRAW', text: 'Draw by stalemate', winner: null };\n  if (pos.isInsufficientMaterial()) return { kind: 'DRAW', text: 'Draw by insufficient material', winner: null };\n  if (pos.isEnd()) return { kind: 'DRAW', text: 'Game over', winner: null };\n  return null;\n}",
    "function gameResult(pos: Chess, history: readonly string[]): { kind: GameResultKind; text: string; winner: Color | null } | null {\n  return adjudicateChess(pos, history);\n}",
  ],
  [
    "  const position = useRef<Chess | null>(null);\n  const moveHandler",
    "  const position = useRef<Chess | null>(null);\n  const positionHistory = useRef<string[]>([]);\n  const moveHandler",
  ],
  [
    "    position.current = pos;\n    terminalSoundPlayed.current = false;",
    "    position.current = pos;\n    positionHistory.current = [chessPositionKey(pos)];\n    terminalSoundPlayed.current = false;",
  ],
  [
    "    const san = makeSan(pos, move);\n    pos.play(move);\n    playChessSound",
    "    const san = makeSan(pos, move);\n    pos.play(move);\n    positionHistory.current = appendPositionHistory(positionHistory.current, pos);\n    playChessSound",
  ],
  [
    "    const ending = gameResult(pos);",
    "    const ending = gameResult(pos, positionHistory.current);",
  ],
]);

await patch('src/premium/PremiumBoard3D.tsx', [
  [
    "import { canColorMove, clockOwner, sessionUiPhase, type GameResultKind } from '../../shared/gameSession';",
    "import { canColorMove, clockOwner, sessionUiPhase, type GameResultKind } from '../../shared/gameSession';\nimport { adjudicateChess, appendPositionHistory, chessPositionKey } from '../../shared/chess960Rules';",
  ],
  [
    "function resultOf(pos: Chess): { kind: GameResultKind; text: string; winner: Color | null } | null {\n  if (pos.isCheckmate()) {\n    const winner = pos.turn === 'white' ? 'black' : 'white';\n    return { kind: 'CHECKMATE', text: `${winner === 'white' ? 'White' : 'Black'} wins by checkmate`, winner };\n  }\n  if (pos.isStalemate()) return { kind: 'DRAW', text: 'Draw by stalemate', winner: null };\n  if (pos.isInsufficientMaterial()) return { kind: 'DRAW', text: 'Draw by insufficient material', winner: null };\n  return pos.isEnd() ? { kind: 'DRAW', text: 'Game over', winner: null } : null;\n}",
    "function resultOf(pos: Chess, history: readonly string[]): { kind: GameResultKind; text: string; winner: Color | null } | null {\n  return adjudicateChess(pos, history);\n}",
  ],
  [
    "  const position = useRef<Chess | null>(null);\n  const engine",
    "  const position = useRef<Chess | null>(null);\n  const positionHistory = useRef<string[]>([]);\n  const engine",
  ],
  [
    "    position.current = pos; setViewColor(chosen ?? 'white'); setHumanColor(chosen);",
    "    position.current = pos; positionHistory.current = [chessPositionKey(pos)]; setViewColor(chosen ?? 'white'); setHumanColor(chosen);",
  ],
  [
    "    const movingColor = pos.turn; const san = makeSan(pos, move); const capture = san.includes('x'); pos.play(move);\n    playChessSound",
    "    const movingColor = pos.turn; const san = makeSan(pos, move); const capture = san.includes('x'); pos.play(move);\n    positionHistory.current = appendPositionHistory(positionHistory.current, pos);\n    playChessSound",
  ],
  [
    "    const end = resultOf(pos);",
    "    const end = resultOf(pos, positionHistory.current);",
  ],
]);

console.log('Applied Chess960 rules integration to server, 2D local play, and premium 3D.');
