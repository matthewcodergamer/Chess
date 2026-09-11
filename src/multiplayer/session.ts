import { createGameSession, type GameSessionModel, type GameSessionState } from '../../shared/gameSession';
import type { RoomSnapshot } from './types';

const stateFromLegacy = (snapshot: RoomSnapshot): GameSessionState => {
  if (snapshot.status === 'waiting') return 'LOBBY';
  if (snapshot.status === 'coin') return 'COIN_TOSS';
  if (snapshot.status === 'strategy') return 'COUNTDOWN';
  if (snapshot.status === 'playing') return 'ACTIVE';
  if (snapshot.checkmate) return 'CHECKMATE';
  if (/resign/i.test(snapshot.result ?? '')) return 'RESIGN';
  if (/time/i.test(snapshot.result ?? '')) return 'TIMEOUT';
  if (/draw|stalemate|insufficient/i.test(snapshot.result ?? '')) return 'DRAW';
  return 'FINAL';
};

const resultKindFromLegacy = (snapshot: RoomSnapshot): GameSessionModel['resultKind'] => {
  if (!snapshot.result) return null;
  if (snapshot.checkmate) return 'CHECKMATE';
  if (/resign/i.test(snapshot.result)) return 'RESIGN';
  if (/time/i.test(snapshot.result)) return 'TIMEOUT';
  if (/draw|stalemate|insufficient/i.test(snapshot.result)) return 'DRAW';
  return 'OTHER';
};

export function authoritativeRoomSession(snapshot: RoomSnapshot): GameSessionModel {
  if (snapshot.session) return snapshot.session;
  const session = createGameSession({
    id: `room-${snapshot.code}`,
    state: stateFromLegacy(snapshot),
    positionId: snapshot.positionId,
    fen: snapshot.fen,
    sideToMove: snapshot.turn,
    whiteClockMs: snapshot.whiteClockMs,
    blackClockMs: snapshot.blackClockMs,
    incrementMs: 0,
    countdownEndsAt: snapshot.strategyEndsAt,
    countdownMs: snapshot.strategyEndsAt ? Math.max(0, snapshot.strategyEndsAt - snapshot.serverNow) : 0,
    connectionStatus: 'CONNECTED',
    now: snapshot.serverNow,
  });
  return {
    ...session,
    pendingClockPress: snapshot.awaitingClockPress,
    moveNumber: snapshot.moves.length,
    movesSan: snapshot.moves,
    result: snapshot.result,
    resultKind: resultKindFromLegacy(snapshot),
    check: snapshot.check,
    checkmate: snapshot.checkmate,
    clocks: { ...session.clocks, startedAt: snapshot.turnStartedAt },
    connection: {
      status: snapshot.status === 'playing' && (!snapshot.players.white?.connected || !snapshot.players.black?.connected) ? 'RECONNECTING' : 'CONNECTED',
      white: Boolean(snapshot.players.white?.connected),
      black: Boolean(snapshot.players.black?.connected),
    },
  };
}
