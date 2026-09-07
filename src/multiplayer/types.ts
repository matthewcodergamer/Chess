import type { Color as GroundColor } from '@lichess-org/chessground/types';

export type RoomStatus = 'waiting' | 'strategy' | 'playing' | 'ended';
export type SeatColor = GroundColor;

export type RoomPlayer = {
  name: string;
  connected: boolean;
};

export type RoomSnapshot = {
  code: string;
  status: RoomStatus;
  positionId: number;
  fen: string;
  turn: GroundColor;
  whiteClockMs: number;
  blackClockMs: number;
  turnStartedAt: number | null;
  strategyEndsAt: number | null;
  serverNow: number;
  moves: string[];
  result: string | null;
  check: boolean;
  checkmate: boolean;
  players: {
    white: RoomPlayer | null;
    black: RoomPlayer | null;
  };
};

export type RoomSeat = {
  code: string;
  token: string;
  color: SeatColor;
};

export type ServerEvent =
  | { type: 'snapshot'; room: RoomSnapshot }
  | { type: 'error'; message: string };
