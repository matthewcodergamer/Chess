import type { Color as GroundColor } from '@lichess-org/chessground/types';

export type RoomStatus = 'waiting' | 'coin' | 'strategy' | 'playing' | 'ended';
export type SeatColor = GroundColor;
export type CoinFace = 'heads' | 'tails';

export type RoomPlayer = { name: string; connected: boolean };

export type RoomSnapshot = {
  code: string;
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
  | { type: 'error'; message: string };
