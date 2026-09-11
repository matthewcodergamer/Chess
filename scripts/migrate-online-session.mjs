import fs from 'node:fs';

const path = 'src/multiplayer/OnlineArena.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('const gameSession = useMemo(() => snapshot ? authoritativeRoomSession(snapshot) : null')) {
  console.log('OnlineArena already consumes the authoritative GameSessionModel.');
  process.exit(0);
}

function required(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  source = source.replace(from, to);
}

required(
  "import type { CoinFace, RoomSeat, RoomSnapshot, ServerEvent } from './types';\n",
  "import type { CoinFace, RoomSeat, RoomSnapshot, ServerEvent } from './types';\nimport { authoritativeRoomSession } from './session';\nimport { canColorMove, canLeaveGameSession, canOfferDraw, canResignGameSession, clockOwner, isTerminalGameState } from '../../shared/gameSession';\n",
  'authoritative session imports',
);

required(
`function roomPosition(snapshot: RoomSnapshot | null): Chess | null {
  if (!snapshot) return null;
  try { return Chess.fromSetup(parseFen(snapshot.fen).unwrap()).unwrap(); } catch { return null; }
}`,
`function roomPosition(fen: string | undefined): Chess | null {
  if (!fen) return null;
  try { return Chess.fromSetup(parseFen(fen).unwrap()).unwrap(); } catch { return null; }
}`,
  'roomPosition helper',
);

required(
`  const pos = useMemo(() => roomPosition(snapshot), [snapshot]);
  const yourTurn = Boolean(seat && snapshot && snapshot.status === 'playing' && !snapshot.awaitingClockPress && snapshot.turn === seat.color && !snapshot.result);
  const elapsed = snapshot ? Math.max(0, now - snapshotAt) : 0;
  const strategySeconds = snapshot?.strategyEndsAt ? Math.max(0, Math.ceil((snapshot.strategyEndsAt - snapshot.serverNow - elapsed) / 1000)) : 0;
  const whiteMs = snapshot ? Math.max(0, snapshot.whiteClockMs - (snapshot.status === 'playing' && snapshot.activeClock === 'white' ? elapsed : 0)) : 0;
  const blackMs = snapshot ? Math.max(0, snapshot.blackClockMs - (snapshot.status === 'playing' && snapshot.activeClock === 'black' ? elapsed : 0)) : 0;`,
`  const gameSession = useMemo(() => snapshot ? authoritativeRoomSession(snapshot) : null, [snapshot]);
  const pos = useMemo(() => roomPosition(gameSession?.fen), [gameSession?.fen]);
  const yourTurn = Boolean(seat && gameSession && canColorMove(gameSession, seat.color));
  const elapsed = snapshot ? Math.max(0, now - snapshotAt) : 0;
  const activeColor = gameSession ? clockOwner(gameSession) : null;
  const strategySeconds = gameSession?.state === 'COUNTDOWN'
    ? Math.max(0, Math.ceil((gameSession.countdownEndsAt ? gameSession.countdownEndsAt - (snapshot?.serverNow ?? now) - elapsed : gameSession.countdownMs - elapsed) / 1000))
    : 0;
  const whiteMs = gameSession ? Math.max(0, gameSession.clocks.whiteMs - (activeColor === 'white' ? elapsed : 0)) : 0;
  const blackMs = gameSession ? Math.max(0, gameSession.clocks.blackMs - (activeColor === 'black' ? elapsed : 0)) : 0;`,
  'authoritative derived state',
);

required(
`  const syncBoard = useCallback(() => {
    if (!ground.current || !snapshot || !pos) return;
    ground.current.set({
      fen: snapshot.fen,
      orientation: seat?.color ?? 'white',
      turnColor: snapshot.turn,
      check: false,
      animation: { enabled: !reducedMotion, duration: pieceMotionMs },
      draggable: { enabled: yourTurn, autoDistance: true, showGhost: true },
      selectable: { enabled: yourTurn },
      movable: {
        free: false,
        color: yourTurn ? snapshot.turn : undefined,
        dests: yourTurn ? chessgroundDests(pos, { chess960: true }) : new Map(),
        showDests: true,
        rookCastle: true,
      },
    });
  }, [pieceMotionMs, pos, reducedMotion, seat?.color, snapshot, yourTurn]);`,
`  const syncBoard = useCallback(() => {
    if (!ground.current || !gameSession || !pos) return;
    ground.current.set({
      fen: gameSession.fen,
      orientation: seat?.color ?? 'white',
      turnColor: gameSession.sideToMove,
      check: gameSession.check,
      animation: { enabled: !reducedMotion, duration: pieceMotionMs },
      draggable: { enabled: yourTurn, autoDistance: true, showGhost: true },
      selectable: { enabled: yourTurn },
      movable: {
        free: false,
        color: yourTurn ? gameSession.sideToMove : undefined,
        dests: yourTurn ? chessgroundDests(pos, { chess960: true }) : new Map(),
        showDests: true,
        rookCastle: true,
      },
    });
  }, [gameSession, pieceMotionMs, pos, reducedMotion, seat?.color, yourTurn]);`,
  'authoritative board sync',
);

required(
`  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.moves.length > lastMoveSoundCount.current) {
      playChessSound((snapshot.moves.at(-1) ?? '').includes('x') ? 'capture' : 'move');
      lastMoveSoundCount.current = snapshot.moves.length;
    }
    if (snapshot.coin.result && snapshot.coin.result !== lastCoinResult.current) {
      playChessSound('coin');
      lastCoinResult.current = snapshot.coin.result;
    }
    if (snapshot.result && snapshot.result !== lastResult.current) {
      playChessSound('win');
      lastResult.current = snapshot.result;
    }
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot || !['coin', 'strategy', 'playing'].includes(snapshot.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [snapshot?.status]);`,
`  useEffect(() => {
    if (!snapshot || !gameSession) return;
    if (gameSession.movesSan.length > lastMoveSoundCount.current) {
      playChessSound((gameSession.movesSan.at(-1) ?? '').includes('x') ? 'capture' : 'move');
      lastMoveSoundCount.current = gameSession.movesSan.length;
    }
    if (snapshot.coin.result && snapshot.coin.result !== lastCoinResult.current) {
      playChessSound('coin');
      lastCoinResult.current = snapshot.coin.result;
    }
    if (gameSession.result && gameSession.result !== lastResult.current) {
      playChessSound('win');
      lastResult.current = gameSession.result;
    }
  }, [gameSession, snapshot]);

  useEffect(() => {
    if (!gameSession || !['COIN_TOSS', 'COLOR_SELECTION', 'COUNTDOWN', 'ACTIVE'].includes(gameSession.state)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [gameSession?.state]);`,
  'authoritative effects',
);

required(
`  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen: snapshot?.fen,
    orientation: seat?.color ?? 'white',
    turnColor: snapshot?.turn ?? 'white',`,
`  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen: gameSession?.fen,
    orientation: seat?.color ?? 'white',
    turnColor: gameSession?.sideToMove ?? 'white',`,
  'authoritative board config',
);
required(
`  }), [seat?.color, snapshot?.code, snapshot?.fen, snapshot?.turn]);`,
`  }), [gameSession?.fen, gameSession?.sideToMove, seat?.color, snapshot?.code]);`,
  'board config dependencies',
);

required(
`  const canLeave = snapshot?.status !== 'playing';
  const bidAllowed = Boolean(snapshot && (snapshot.status === 'coin' || snapshot.status === 'strategy'));
  const colorBidAllowed = Boolean(snapshot && snapshot.status === 'coin' && !snapshot.coin.result);
  const bidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || livePositionBidsEnabled);
  const colorBidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || liveColorBidsEnabled);
  const opponentColor: 'white' | 'black' = seat?.color === 'white' ? 'black' : 'white';
  const playerFor = (color: 'white' | 'black') => snapshot?.players[color] ?? null;
  const clockFor = (color: 'white' | 'black') => formatClockMs(color === 'white' ? whiteMs : blackMs);`,
`  const canLeave = !gameSession || canLeaveGameSession(gameSession);
  const canDraw = Boolean(gameSession && canOfferDraw(gameSession));
  const canResign = Boolean(gameSession && canResignGameSession(gameSession));
  const bidAllowed = Boolean(snapshot && gameSession && ['COLOR_SELECTION', 'COIN_TOSS', 'COUNTDOWN'].includes(gameSession.state));
  const colorBidAllowed = Boolean(snapshot && gameSession && ['COLOR_SELECTION', 'COIN_TOSS'].includes(gameSession.state) && !snapshot.coin.result);
  const bidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || livePositionBidsEnabled);
  const colorBidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || liveColorBidsEnabled);
  const opponentColor: 'white' | 'black' = seat?.color === 'white' ? 'black' : 'white';
  const playerFor = (color: 'white' | 'black') => snapshot?.players[color] ?? null;
  const clockFor = (color: 'white' | 'black') => formatClockMs(color === 'white' ? whiteMs : blackMs);
  const opponentOfferedDraw = Boolean(gameSession?.drawOffers[opponentColor]);
  const youOfferedDraw = Boolean(seat && gameSession?.drawOffers[seat.color]);`,
  'authoritative control selectors',
);

source = source.replace('<section className="online-room-shell">', '<section className="online-room-shell" data-game-state={gameSession?.state ?? \'LOBBY\'}>');
source = source.replace('<div className="match-game-meta"><b>Chess960 · #{snapshot.positionId}</b>', '<div className="match-game-meta"><b>Chess960 · #{gameSession?.positionId ?? snapshot.positionId}</b>');
source = source.replace('fen={snapshot.fen}\n            active={snapshot.activeClock === opponentColor && snapshot.status === \'playing\'}', 'fen={gameSession?.fen ?? snapshot.fen}\n            active={activeColor === opponentColor}');
source = source.replace('fen={snapshot.fen}\n            active={snapshot.activeClock === seat.color && snapshot.status === \'playing\'}', 'fen={gameSession?.fen ?? snapshot.fen}\n            active={activeColor === seat.color}');

required(
`            {snapshot.status === 'waiting' && <div className="board-overlay online-waiting-overlay"><div><span>WAITING FOR OPPONENT</span><strong className="room-code-display">{snapshot.code}</strong><small>Share this code or invite link with player two.</small></div></div>}
            {snapshot.status === 'coin' && <div className="board-overlay coin-overlay">`,
`            {gameSession?.state === 'LOBBY' && <div className="board-overlay online-waiting-overlay"><div><span>WAITING FOR OPPONENT</span><strong className="room-code-display">{snapshot.code}</strong><small>Share this code or invite link with player two.</small></div></div>}
            {(gameSession?.state === 'COLOR_SELECTION' || gameSession?.state === 'COIN_TOSS') && <div className="board-overlay coin-overlay">`,
  'lobby/coin overlays',
);
source = source.replace("{snapshot.status === 'strategy' && <div className=\"board-overlay strategy-overlay online-strategy-overlay\">", "{gameSession?.state === 'COUNTDOWN' && <div className=\"board-overlay strategy-overlay online-strategy-overlay\">");
source = source.replace("{snapshot.status === 'ended' && snapshot.result && <div className=\"board-overlay ended online-ended-overlay\"><div><span>GAME OVER</span><strong className=\"end-title\">{snapshot.result}</strong></div></div>}", "{gameSession && isTerminalGameState(gameSession.state) && gameSession.result && <div className=\"board-overlay ended online-ended-overlay\"><div><span>GAME OVER</span><strong className=\"end-title\">{gameSession.result}</strong></div></div>}");

required(
`          <PhysicalChessClock
            whiteSeconds={whiteMs / 1000}
            blackSeconds={blackMs / 1000}
            activeColor={snapshot.status === 'playing' ? snapshot.activeClock : null}
            pendingSlap={snapshot.awaitingClockPress}
            disabled={snapshot.awaitingClockPress !== seat.color}`, 
`          <PhysicalChessClock
            whiteSeconds={whiteMs / 1000}
            blackSeconds={blackMs / 1000}
            activeColor={activeColor}
            pendingSlap={gameSession?.pendingClockPress ?? null}
            disabled={gameSession?.pendingClockPress !== seat.color}`,
  'authoritative physical clock',
);

required(
`          <div className="match-controls" aria-label="Game controls">
            <div className={\`match-turn-note ${'${yourTurn ? \'active\' : \'\'}'}\`}>{snapshot.status === 'ended' ? snapshot.result : snapshot.awaitingClockPress === seat.color ? 'Move made — press your clock' : snapshot.awaitingClockPress ? 'Opponent is pressing their clock' : snapshot.status === 'playing' ? yourTurn ? 'Your move' : 'Opponent move' : snapshot.status === 'strategy' ? 'Strategy phase' : snapshot.status === 'coin' ? 'Color selection' : 'Waiting for opponent'}</div>
            {snapshot.awaitingClockPress === seat.color && !showClock && <button className={\`clock-slap-inline ${'${seat.color}'}\`} onClick={() => send({ type: 'clock_slap' })}>Slap clock</button>}
            <button onClick={() => setMessage('Draw offers are not available in live rooms yet.')} disabled={snapshot.status !== 'playing'}>Draw</button>
            <button className="match-resign resign-button" onClick={() => send({ type: 'resign' })} disabled={snapshot.status !== 'playing'}>Resign</button>
            <button aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}>Options</button>
          </div>`,
`          <div className="match-controls" aria-label="Game controls">
            <div className={\`match-turn-note ${'${yourTurn ? \'active\' : \'\'}'}\`}>{gameSession && isTerminalGameState(gameSession.state) ? gameSession.result : gameSession?.pendingClockPress === seat.color ? 'Move made — press your clock' : gameSession?.pendingClockPress ? 'Opponent is pressing their clock' : gameSession?.state === 'ACTIVE' ? yourTurn ? 'Your move' : 'Opponent move' : gameSession?.state === 'RECONNECTING' ? 'Reconnecting — clocks paused' : gameSession?.state === 'PAUSED' ? 'Game paused' : gameSession?.state === 'COUNTDOWN' ? 'Strategy phase' : gameSession?.state === 'COLOR_SELECTION' || gameSession?.state === 'COIN_TOSS' ? 'Color selection' : gameSession?.state === 'READY' ? 'Players ready' : 'Waiting for opponent'}</div>
            {gameSession?.pendingClockPress === seat.color && !showClock && <button className={\`clock-slap-inline ${'${seat.color}'}\`} onClick={() => send({ type: 'clock_slap' })}>Slap clock</button>}
            <button onClick={() => send({ type: opponentOfferedDraw ? 'accept_draw' : 'offer_draw' })} disabled={!canDraw || youOfferedDraw}>{opponentOfferedDraw ? 'Accept draw' : youOfferedDraw ? 'Draw offered' : 'Draw'}</button>
            {opponentOfferedDraw && canDraw && <button onClick={() => send({ type: 'decline_draw' })}>Decline</button>}
            <button className="match-resign resign-button" onClick={() => send({ type: 'resign' })} disabled={!canResign}>Resign</button>
            <button aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}>Options</button>
          </div>`,
  'authoritative draw/resign controls',
);

required(
`            <div><span>Position</span><b>Chess960 #{snapshot.positionId}</b></div>
            <div><span>Moves</span><b>{snapshot.moves.length}</b></div>
            <div><span>Connection</span><b>{connection}</b></div>`,
`            <div><span>Position</span><b>Chess960 #{gameSession?.positionId ?? snapshot.positionId}</b></div>
            <div><span>Moves</span><b>{gameSession?.moveNumber ?? 0}</b></div>
            <div><span>State</span><b>{gameSession?.state ?? 'LOBBY'}</b></div>
            <div><span>Connection</span><b>{gameSession?.connection.status ?? 'DISCONNECTED'}</b></div>
            <div><span>Increment</span><b>{(gameSession?.clocks.incrementMs ?? 0) / 1000}s</b></div>`,
  'authoritative options diagnostics',
);
required(
`            <div className="match-move-list"><span className="qqurz-kicker">MOVES</span>{snapshot.moves.length ? <ol>{snapshot.moves.map((move, index) => <li key={\`${'${move}-${index}'}\`}>{move}</li>)}</ol> : <p>No moves yet.</p>}</div>`,
`            <div className="match-move-list"><span className="qqurz-kicker">MOVES</span>{gameSession?.movesSan.length ? <ol>{gameSession.movesSan.map((move, index) => <li key={\`${'${move}-${index}'}\`}>{move}</li>)}</ol> : <p>No moves yet.</p>}</div>`,
  'authoritative move list',
);

source = source.replaceAll("color={snapshot?.turn ?? seat.color}", "color={gameSession?.sideToMove ?? seat.color}");

if (/snapshot\.(status|turn|activeClock|awaitingClockPress|whiteClockMs|blackClockMs|result|moves)\b/.test(source)) {
  const remaining = source.match(/snapshot\.(status|turn|activeClock|awaitingClockPress|whiteClockMs|blackClockMs|result|moves)\b/g) ?? [];
  throw new Error(`Legacy game-state reads remain in OnlineArena: ${[...new Set(remaining)].join(', ')}`);
}

fs.writeFileSync(path, source);
console.log('OnlineArena now renders from the authoritative GameSessionModel.');
