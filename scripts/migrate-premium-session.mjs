import fs from 'node:fs';

const path = 'src/premium/PremiumBoard3D.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceRequired(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  "import { chess960BackRank, chess960Fen, randomChess960Id } from '../game/chess960';\n",
  "import { chess960BackRank, chess960Fen, randomChess960Id } from '../game/chess960';\nimport { useGameSession } from '../game/useGameSession';\nimport { canColorMove, clockOwner, sessionUiPhase, type GameResultKind } from '../../shared/gameSession';\n",
  'session imports',
);
source = source.replace("type Phase = 'setup' | 'strategy' | 'playing' | 'ended';\n", '');
source = source.replace('const GAME_SECONDS = 600;\nconst STRATEGY_SECONDS = 120;', 'const GAME_MS = 10 * 60 * 1000;\nconst STRATEGY_MS = 2 * 60 * 1000;');

replaceRequired(
`function resultOf(pos: Chess) {
  if (pos.isCheckmate()) return pos.turn === 'white' ? 'Black wins by checkmate' : 'White wins by checkmate';
  if (pos.isStalemate()) return 'Draw by stalemate';
  if (pos.isInsufficientMaterial()) return 'Draw by insufficient material';
  return pos.isEnd() ? 'Game over' : null;
}`,
`function resultOf(pos: Chess): { kind: GameResultKind; text: string; winner: Color | null } | null {
  if (pos.isCheckmate()) {
    const winner = pos.turn === 'white' ? 'black' : 'white';
    return { kind: 'CHECKMATE', text: \`${'${winner === \'white\' ? \'White\' : \'Black\'}'} wins by checkmate\`, winner };
  }
  if (pos.isStalemate()) return { kind: 'DRAW', text: 'Draw by stalemate', winner: null };
  if (pos.isInsufficientMaterial()) return { kind: 'DRAW', text: 'Draw by insufficient material', winner: null };
  return pos.isEnd() ? { kind: 'DRAW', text: 'Game over', winner: null } : null;
}`,
  'result classifier',
);

replaceRequired(
`  const [mode, setMode] = useState<GameMode>('human');
  const [phase, setPhase] = useState<Phase>('setup');
  const [positionId, setPositionId] = useState<number | null>(null);
  const [fen, setFen] = useState('');
  const [turn, setTurn] = useState<Color>('white');
  const [viewColor, setViewColor] = useState<Color>('white');
  const [moves, setMoves] = useState<string[]>([]);
  const [whiteClock, setWhiteClock] = useState(GAME_SECONDS);
  const [blackClock, setBlackClock] = useState(GAME_SECONDS);
  const [strategyTime, setStrategyTime] = useState(STRATEGY_SECONDS);
  const [fastForward, setFastForward] = useState(false);`,
`  const { session, dispatchSession } = useGameSession({ state: 'LOBBY', clockMs: GAME_MS, incrementMs: 0, connectionStatus: 'LOCAL' });
  const [mode, setMode] = useState<GameMode>('human');
  const [viewColor, setViewColor] = useState<Color>('white');
  const [fastForward, setFastForward] = useState(false);`,
  'session state hooks',
);
source = source.replace("  const [result, setResult] = useState<string | null>(null);\n", '');
source = source.replace("  const [pendingSlap, setPendingSlap] = useState<Color | null>(null);\n", '');
replaceRequired(
`  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  useEffect(() => subscribeClockVisible(setShowClock), []);
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);
  const humanCanMove = useCallback((pos: Chess) => phase === 'playing' && !pendingSlap && (mode === 'human' || humanColor === pos.turn), [humanColor, mode, pendingSlap, phase]);`,
`  const phase = sessionUiPhase(session);
  const positionId = session.positionId;
  const fen = session.fen;
  const turn = session.sideToMove as Color;
  const moves = session.movesSan;
  const whiteClock = session.clocks.whiteMs / 1000;
  const blackClock = session.clocks.blackMs / 1000;
  const strategyTime = session.countdownMs / 1000;
  const result = session.result;
  const pendingSlap = session.pendingClockPress as Color | null;
  const activeColor = clockOwner(session) as Color | null;
  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  useEffect(() => subscribeClockVisible(setShowClock), []);
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);
  const humanCanMove = useCallback((pos: Chess) => canColorMove(session, pos.turn) && (mode === 'human' || humanColor === pos.turn), [humanColor, mode, session]);`,
  'session aliases',
);

replaceRequired(
`    position.current = pos; setPositionId(id); setFen(makeFen(pos.toSetup())); setTurn('white'); setViewColor(chosen ?? 'white'); setHumanColor(chosen);
    setMoves([]); setWhiteClock(GAME_SECONDS); setBlackClock(GAME_SECONDS); setStrategyTime(STRATEGY_SECONDS); setFastForward(false); setResult(null); setSelected(null); setPromotion(null); setPendingSlap(null); setEngineError(''); setPhase('strategy');
  }, [mode, sideChoice]);`,
`    position.current = pos; setViewColor(chosen ?? 'white'); setHumanColor(chosen);
    dispatchSession({ type: 'RESET', options: { state: 'COUNTDOWN', positionId: id, fen: makeFen(pos.toSetup()), sideToMove: 'white', clockMs: GAME_MS, incrementMs: 0, countdownMs: STRATEGY_MS, connectionStatus: 'LOCAL' } });
    setFastForward(false); setSelected(null); setPromotion(null); setEngineError('');
  }, [dispatchSession, mode, sideChoice]);`,
  'create position',
);

replaceRequired(
`    if (!pos || phase !== 'playing' || pendingSlap || !pos.isLegal(move)) return false;
    const movingColor = pos.turn; const san = makeSan(pos, move); const capture = san.includes('x'); pos.play(move);
    playChessSound(capture ? 'capture' : 'move'); setFen(makeFen(pos.toSetup())); setTurn(pos.turn); setMoves(v => [...v, san]); setSelected(null);
    const end = resultOf(pos);
    if (end) { setResult(end); setPhase('ended'); setPendingSlap(null); playChessSound('win'); engine.current?.cancelSearch(); }
    else setPendingSlap(movingColor);
    return true;
  }, [pendingSlap, phase]);`,
`    if (!pos || !canColorMove(session, pos.turn) || !pos.isLegal(move)) return false;
    const movingColor = pos.turn; const san = makeSan(pos, move); const capture = san.includes('x'); pos.play(move);
    playChessSound(capture ? 'capture' : 'move');
    dispatchSession({ type: 'MOVE_COMMITTED', fen: makeFen(pos.toSetup()), sideToMove: pos.turn, mover: movingColor, san, check: pos.isCheck(), checkmate: pos.isCheckmate() });
    setSelected(null);
    const end = resultOf(pos);
    if (end) { dispatchSession({ type: 'FINISH', ...end }); playChessSound('win'); engine.current?.cancelSearch(); }
    return true;
  }, [dispatchSession, session]);`,
  'finish move',
);

replaceRequired(
`  useEffect(() => { if (phase !== 'strategy') return; if (strategyTime <= 0) { setFastForward(false); setPhase('playing'); return; } const timer = window.setTimeout(() => setStrategyTime(v => Math.max(0, v - 1)), fastForward ? 250 : 1000); return () => window.clearTimeout(timer); }, [fastForward, phase, strategyTime]);
  useEffect(() => { if (phase !== 'playing') return; const timer = window.setInterval(() => { const pos = position.current; if (!pos) return; const owner = pendingSlap ?? pos.turn; if (mode === 'ai' && owner === aiColor && engineStatus === 'loading') return; const setter = owner === 'white' ? setWhiteClock : setBlackClock; setter(v => { const n = Math.max(0, v - 1); if (n === 0) { setResult(owner === 'white' ? 'Black wins on time' : 'White wins on time'); setPhase('ended'); setPendingSlap(null); playChessSound('win'); engine.current?.cancelSearch(); } return n; }); }, 1000); return () => window.clearInterval(timer); }, [aiColor, engineStatus, mode, pendingSlap, phase]);
  useEffect(() => { const pos = position.current; if (phase !== 'playing' || mode !== 'ai' || !aiColor || !pos || pendingSlap || pos.turn !== aiColor || result) return; let cancelled = false; const snapshot = makeFen(pos.toSetup()); void (async () => { try { const e = await ensureEngine(); if (!e.isReady()) { setEngineStatus('loading'); await e.init(); } if (cancelled) return; setEngineStatus('thinking'); const uci = await e.bestMove(snapshot, difficulty), current = position.current; if (cancelled || !current || current.turn !== aiColor || makeFen(current.toSetup()) !== snapshot) return; const move = parseUci(uci); if (!move || !current.isLegal(move)) throw new Error('Stockfish returned an invalid move.'); finishMove(move); setEngineStatus('ready'); } catch (err) { if (!cancelled) { setEngineStatus('error'); setEngineError(err instanceof Error ? err.message : 'Stockfish could not move.'); } } })(); return () => { cancelled = true; engine.current?.cancelSearch(); }; }, [aiColor, difficulty, ensureEngine, fen, finishMove, mode, pendingSlap, phase, result, turn]);
  useEffect(() => { if (phase !== 'playing' || mode !== 'ai' || !aiColor || !pendingSlap) return; const delay = pendingSlap === aiColor ? 220 : 120; const timer = window.setTimeout(() => setPendingSlap(null), delay); return () => window.clearTimeout(timer); }, [aiColor, mode, pendingSlap, phase]);`,
`  useEffect(() => { if (session.state !== 'COUNTDOWN') return; if (session.countdownMs <= 0) { setFastForward(false); dispatchSession({ type: 'TRANSITION', to: 'ACTIVE' }); return; } const timer = window.setTimeout(() => dispatchSession({ type: 'COUNTDOWN_TICK', elapsedMs: 1000 }), fastForward ? 250 : 1000); return () => window.clearTimeout(timer); }, [dispatchSession, fastForward, session.countdownMs, session.state]);
  useEffect(() => { if (session.state !== 'ACTIVE') return; const timer = window.setInterval(() => { const owner = clockOwner(session); if (!owner) return; if (mode === 'ai' && owner === aiColor && engineStatus === 'loading') return; dispatchSession({ type: 'CLOCK_TICK', elapsedMs: 1000 }); }, 1000); return () => window.clearInterval(timer); }, [aiColor, dispatchSession, engineStatus, mode, session]);
  useEffect(() => { const pos = position.current; if (session.state !== 'ACTIVE' || mode !== 'ai' || !aiColor || !pos || session.pendingClockPress || session.sideToMove !== aiColor || session.result) return; let cancelled = false; const snapshot = session.fen; void (async () => { try { const e = await ensureEngine(); if (!e.isReady()) { setEngineStatus('loading'); await e.init(); } if (cancelled) return; setEngineStatus('thinking'); const uci = await e.bestMove(snapshot, difficulty), current = position.current; if (cancelled || !current || current.turn !== aiColor || makeFen(current.toSetup()) !== snapshot) return; const move = parseUci(uci); if (!move || !current.isLegal(move)) throw new Error('Stockfish returned an invalid move.'); finishMove(move); setEngineStatus('ready'); } catch (err) { if (!cancelled) { setEngineStatus('error'); setEngineError(err instanceof Error ? err.message : 'Stockfish could not move.'); } } })(); return () => { cancelled = true; engine.current?.cancelSearch(); }; }, [aiColor, difficulty, ensureEngine, finishMove, mode, session.fen, session.pendingClockPress, session.result, session.sideToMove, session.state]);
  useEffect(() => { if (session.state !== 'ACTIVE' || mode !== 'ai' || !aiColor || !session.pendingClockPress) return; const delay = session.pendingClockPress === aiColor ? 220 : 120; const timer = window.setTimeout(() => dispatchSession({ type: 'CLOCK_TRANSFERRED' }), delay); return () => window.clearTimeout(timer); }, [aiColor, dispatchSession, mode, session.pendingClockPress, session.state]);`,
  'session effects',
);

replaceRequired(
`  const startNow = () => { if (phase === 'strategy') { setStrategyTime(0); setFastForward(false); setPhase('playing'); playChessSound('start'); } };
  const slapClock = () => { if (!pendingSlap || pendingSlap === aiColor) return; setPendingSlap(null); };`,
`  const startNow = () => { if (session.state === 'COUNTDOWN') { dispatchSession({ type: 'SET_COUNTDOWN', remainingMs: 0 }); dispatchSession({ type: 'TRANSITION', to: 'ACTIVE' }); setFastForward(false); playChessSound('start'); } };
  const slapClock = () => { if (!session.pendingClockPress || session.pendingClockPress === aiColor || session.state !== 'ACTIVE') return; dispatchSession({ type: 'CLOCK_TRANSFERRED' }); };`,
  'session controls',
);

source = source.replace("activeColor={phase === 'playing' ? (pendingSlap ?? turn) : null}", 'activeColor={activeColor}');
source = source.replace('return <div className={`premium-page-v14 qqurz-content-page three-play-page ${showClock ? \'clock-visible\' : \'clock-hidden\'}`}>', 'return <div data-game-state={session.state} className={`premium-page-v14 qqurz-content-page three-play-page ${showClock ? \'clock-visible\' : \'clock-hidden\'}`}>');
source = source.replace('<li>The same reusable physical clock component is used in every QQURZ game mode.</li>', '<li>The same reusable physical clock and authoritative game session are used in every QQURZ game mode.</li>');

fs.writeFileSync(path, source);
console.log('Premium 3D moved to shared GameSession state machine.');
// rerun after the clock invariant learned the canonical session field names
