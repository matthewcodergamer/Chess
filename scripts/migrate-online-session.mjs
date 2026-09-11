import fs from 'node:fs';

const path = 'src/multiplayer/OnlineArena.tsx';
let source = fs.readFileSync(path, 'utf8');

function required(from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  source = source.replace(from, to);
}

required(
  "import type { CoinFace, RoomSeat, RoomSnapshot, ServerEvent } from './types';\n",
  "import type { CoinFace, RoomSeat, RoomSnapshot, ServerEvent } from './types';\nimport { authoritativeRoomSession } from './session';\nimport { canColorMove, clockOwner, isTerminalGameState } from '../../shared/gameSession';\n",
  'session imports',
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
  'roomPosition',
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
  const strategySeconds = gameSession?.state === 'COUNTDOWN' && gameSession.countdownEndsAt
    ? Math.max(0, Math.ceil((gameSession.countdownEndsAt - (snapshot?.serverNow ?? now) - elapsed) / 1000))
    : Math.max(0, Math.ceil((gameSession?.countdownMs ?? 0) / 1000));
  const whiteMs = gameSession ? Math.max(0, gameSession.clocks.whiteMs - (activeColor === 'white' ? elapsed : 0)) : 0;
  const blackMs = gameSession ? Math.max(0, gameSession.clocks.blackMs - (activeColor === 'black' ? elapsed : 0)) : 0;`,
  'derived authoritative state',
);

required(
`    if (!ground.current || !snapshot || !pos) return;
    ground.current.set({
      fen: snapshot.fen,
      orientation: seat?.color ?? 'white',
      turnColor: snapshot.turn,
      check: false,`,
`    if (!ground.current || !gameSession || !pos) return;
    ground.current.set({
      fen: gameSession.fen,
      orientation: seat?.color ?? 'white',
      turnColor: gameSession.sideToMove,
      check: gameSession.check,`,
  'sync board state',
);
source = source.replace('color: yourTurn ? snapshot.turn : undefined,', 'color: yourTurn ? gameSession.sideToMove : undefined,');
source = source.replace('  }, [pieceMotionMs, pos, reducedMotion, seat?.color, snapshot, yourTurn]);', '  }, [gameSession, pieceMotionMs, pos, reducedMotion, seat?.color, yourTurn]);');

required(
`    if (!snapshot) return;
    if (snapshot.moves.length > lastMoveSoundCount.current) {
      playChessSound((snapshot.moves.at(-1) ?? '').includes('x') ? 'capture' : 'move');
      lastMoveSoundCount.current = snapshot.moves.length;
    }`,
`    if (!snapshot || !gameSession) return;
    if (gameSession.movesSan.length > lastMoveSoundCount.current) {
      playChessSound((gameSession.movesSan.at(-1) ?? '').includes('x') ? 'capture' : 'move');
      lastMoveSoundCount.current = gameSession.movesSan.length;
    }`,
  'move sound state',
);
source = source.replace('    if (snapshot.result && snapshot.result !== lastResult.current) {\n      playChessSound(\'win\');\n      lastResult.current = snapshot.result;\n    }', "    if (gameSession.result && gameSession.result !== lastResult.current) {\n      playChessSound('win');\n      lastResult.current = gameSession.result;\n    }");
source = source.replace('  }, [snapshot]);', '  }, [gameSession, snapshot]);');

required(
`    if (!snapshot || !['coin', 'strategy', 'playing'].includes(snapshot.status)) return;`,
`    if (!gameSession || !['COIN_TOSS', 'COUNTDOWN', 'ACTIVE', 'RECONNECTING'].includes(gameSession.state)) return;`,
  'ticker lifecycle',
);
source = source.replace('  }, [snapshot?.status]);', '  }, [gameSession?.state]);');

required(
`  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen: snapshot?.fen,
    orientation: seat?.color ?? 'white',
    turnColor: snapshot?.turn ?? 'white',`,
`  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen: gameSession?.fen,
    orientation: seat?.color ?? 'white',
    turnColor: gameSession?.sideToMove ?? 'white',`,
  'board config state',
);
source = source.replace('  }), [seat?.color, snapshot?.code, snapshot?.fen, snapshot?.turn]);', '  }), [gameSession?.fen, gameSession?.sideToMove, seat?.color, snapshot?.code]);');

required(
`  const canLeave = snapshot?.status !== 'playing';
  const bidAllowed = Boolean(snapshot && (snapshot.status === 'coin' || snapshot.status === 'strategy'));
  const colorBidAllowed = Boolean(snapshot && snapshot.status === 'coin' && !snapshot.coin.result);`,
`  const canLeave = !gameSession || !['ACTIVE', 'RECONNECTING'].includes(gameSession.state);
  const bidAllowed = Boolean(snapshot && gameSession && (gameSession.state === 'COIN_TOSS' || gameSession.state === 'COUNTDOWN'));
  const colorBidAllowed = Boolean(snapshot && gameSession?.state === 'COIN_TOSS' && !snapshot.coin.result);`,
  'room lifecycle permissions',
);
source = source.replace("  const clockFor = (color: 'white' | 'black') => formatClockMs(color === 'white' ? whiteMs : blackMs);", "  const clockFor = (color: 'white' | 'black') => formatClockMs(color === 'white' ? whiteMs : blackMs);\n  const opponentOfferedDraw = Boolean(gameSession?.drawOffers[opponentColor]);\n  const youOfferedDraw = Boolean(seat && gameSession?.drawOffers[seat.color]);");

source = source.replaceAll('snapshot.positionId', 'gameSession?.positionId');
source = source.replaceAll('snapshot.fen', 'gameSession?.fen ?? snapshot.fen');
source = source.replaceAll('snapshot.moves.length', 'gameSession?.moveNumber ?? 0');
source = source.replaceAll('snapshot.moves.map', 'gameSession?.movesSan.map');
source = source.replaceAll('snapshot.activeClock === opponentColor && snapshot.status === \'playing\'', 'activeColor === opponentColor');
source = source.replaceAll('snapshot.activeClock === seat.color && snapshot.status === \'playing\'', 'activeColor === seat.color');
source = source.replaceAll('snapshot.status === \'waiting\'', "gameSession?.state === 'LOBBY'");
source = source.replaceAll('snapshot.status === \'coin\'', "gameSession?.state === 'COIN_TOSS'");
source = source.replaceAll('snapshot.status === \'strategy\'', "gameSession?.state === 'COUNTDOWN'");
source = source.replaceAll('snapshot.status === \'playing\'', "gameSession?.state === 'ACTIVE'");
source = source.replaceAll('snapshot.status === \'ended\'', 'Boolean(gameSession && isTerminalGameState(gameSession.state))');
source = source.replaceAll('snapshot.result', 'gameSession?.result');
source = source.replaceAll('snapshot.awaitingClockPress', 'gameSession?.pendingClockPress');
source = source.replaceAll('snapshot.turn', 'gameSession?.sideToMove ?? \'white\'');

required(
`          <PhysicalChessClock
            whiteSeconds={whiteMs / 1000}
            blackSeconds={blackMs / 1000}
            activeColor={gameSession?.state === 'ACTIVE' ? snapshot.activeClock : null}
            pendingSlap={gameSession?.pendingClockPress}
            disabled={gameSession?.pendingClockPress !== seat.color}`, 
`          <PhysicalChessClock
            whiteSeconds={whiteMs / 1000}
            blackSeconds={blackMs / 1000}
            activeColor={activeColor}
            pendingSlap={gameSession?.pendingClockPress}
            disabled={gameSession?.pendingClockPress !== seat.color}`,
  'physical clock canonical state',
);

required(
`            <button onClick={() => setMessage('Draw offers are not available in live rooms yet.')} disabled={gameSession?.state !== 'ACTIVE'}>Draw</button>
            <button className="match-resign resign-button" onClick={() => send({ type: 'resign' })} disabled={gameSession?.state !== 'ACTIVE'}>Resign</button>`,
`            <button
              onClick={() => send({ type: opponentOfferedDraw ? 'accept_draw' : 'offer_draw' })}
              disabled={gameSession?.state !== 'ACTIVE' || youOfferedDraw}
            >{opponentOfferedDraw ? 'Accept draw' : youOfferedDraw ? 'Draw offered' : 'Draw'}</button>
            {opponentOfferedDraw && <button onClick={() => send({ type: 'decline_draw' })}>Decline</button>}
            <button className="match-resign resign-button" onClick={() => send({ type: 'resign' })} disabled={!gameSession || !['ACTIVE', 'RECONNECTING'].includes(gameSession.state)}>Resign</button>`,
  'draw/resign controls',
);

source = source.replace('<section className="online-room-shell">', '<section className="online-room-shell" data-game-state={gameSession?.state ?? \'LOBBY\'}>');
source = source.replace('<div><span>Connection</span><b>{connection}</b></div>', '<div><span>State</span><b>{gameSession?.state ?? \'LOBBY\'}</b></div><div><span>Connection</span><b>{gameSession?.connection.status ?? connection}</b></div><div><span>Increment</span><b>{(gameSession?.clocks.incrementMs ?? 0) / 1000}s</b></div>');
source = source.replace('color={gameSession?.sideToMove ?? \'white\' ?? seat.color}', 'color={gameSession?.sideToMove ?? seat.color}');

fs.writeFileSync(path, source);
console.log('OnlineArena now derives lifecycle, turn, clocks, draw offers and result from GameSessionModel.');
