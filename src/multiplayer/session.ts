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
  if (snapshot.session) {
    const session = snapshot.session;
    if (session.winner || (!session.resultKind && !session.resignedBy && !/resign/i.test(session.result ?? ''))) return session;
    const inferred = session.winner
      ?? (session.resignedBy ? (session.resignedBy === 'white' ? 'black' : 'white') : null)
      ?? (/^White\b/i.test(session.result ?? '') ? 'white' : /^Black\b/i.test(session.result ?? '') ? 'black' : null);
    if (!inferred) return session;
    return {
      ...session,
      resultKind: session.resultKind === 'RESIGN' || /resign/i.test(session.result ?? '') ? 'RESIGN' : session.resultKind,
      winner: inferred,
    };
  }
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
    winner: /resign/i.test(snapshot.result ?? '')
      ? (/^White\b/i.test(snapshot.result ?? '') ? 'white' : /^Black\b/i.test(snapshot.result ?? '') ? 'black' : null)
      : session.winner,
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
