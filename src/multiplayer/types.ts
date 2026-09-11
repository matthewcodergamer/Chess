import type { Color as GroundColor } from '@lichess-org/chessground/types';
import type { GameSessionModel } from '../../shared/gameSession';

/** @deprecated Transport compatibility only. React game screens use RoomSnapshot.session. */
export type RoomStatus = 'waiting' | 'coin' | 'strategy' | 'playing' | 'ended';
export type SeatColor = GroundColor;
export type CoinFace = 'heads' | 'tails';

export type RoomPlayer = { name: string; connected: boolean };
export type MoveTiming = {
  moveNumber: number;
  clientSequence: number | null;
  clientSentAt: number | null;
  serverReceivedAt: number;
  serverCommittedAt: number;
  chargedElapsedMs: number;
  latencyCreditMs: number;
  nextClockStartedAt: number | null;
};

export type RoomSnapshot = {
  code: string;
  /** Canonical match state. New servers always provide this. */
  session?: GameSessionModel;

  // Legacy wire aliases are retained while old room Durable Objects drain.
  // They are normalized in multiplayer/session.ts and must not be interpreted
  // directly by React match components.
  status: RoomStatus;
  positionId: number;
  fen: string;
  turn: GroundColor;
  activeClock: GroundColor | null;
  awaitingClockPress: GroundColor | null;
  whiteClockMs: number;
  blackClockMs: number;
  turnStartedAt: number | null;
  strategyEndsAt: number | null;
  serverNow: number;
  lastMoveTiming: MoveTiming | null;
  moves: string[];
  result: string | null;
  check: boolean;
  checkmate: boolean;
  yourColor: GroundColor | null;
  players: { white: RoomPlayer | null; black: RoomPlayer | null };
  coin: {
    claimedFace: CoinFace | null;
    claimedBy: string | null;
    result: CoinFace | null;
    winner: string | null;
    flippedAt: number | null;
    endsAt: number | null;
    yourFace: CoinFace | null;
  };
  auction: {
    leadingBidCents: number;
    leaderName: string | null;
    rerollCount: number;
    yourBidCents: number;
  };
  colorAuction: {
    leadingBidCents: number;
    leaderName: string | null;
    desiredColor: GroundColor | null;
    yourBidCents: number;
    yourDesiredColor: GroundColor | null;
    yourBidRefunded: boolean;
  };
};

export type RoomSeat = { code: string; token: string; color: SeatColor };

export type ServerEvent =
  | { type: 'snapshot'; room: RoomSnapshot }
  | { type: 'move_ack'; timing: MoveTiming }
  | { type: 'time_sync'; nonce: string; serverSentAt: number }
  | { type: 'error'; message: string };
