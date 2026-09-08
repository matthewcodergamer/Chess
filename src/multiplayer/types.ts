import type { Color as GroundColor } from '@lichess-org/chessground/types';

export type RoomStatus = 'waiting' | 'coinflip' | 'strategy' | 'playing' | 'ended';
export type SeatColor = GroundColor;
export type CoinSide = 'heads' | 'tails';

export type RoomPlayer = {
  name: string;
  connected: boolean;
};

export type CoinFlipState = {
  claimedSide: CoinSide | null;
  claimedBy: GroundColor | null;
  result: CoinSide | null;
  winnerName: string | null;
  revealAt: number | null;
};

export type RerollState = {
  testOnly: true;
  whiteBidCents: number | null;
  blackBidCents: number | null;
  complete: boolean;
  winner: GroundColor | null;
  rerolled: boolean;
  previousPositionId: number | null;
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
  coin: CoinFlipState | null;
  reroll: RerollState;
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
  | { type: 'seat'; color: SeatColor }
  | { type: 'error'; message: string };
