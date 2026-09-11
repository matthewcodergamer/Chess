import { ChessRoom as BaseChessRoom } from './index';

type MoveEnvelope = {
  type: 'move';
  uci?: unknown;
  clientSequence?: unknown;
  clientSentAt?: unknown;
};

type SeatAttachment = { token?: unknown };

const MAX_WS_MESSAGE_BYTES = 4 * 1024;
const REPLAY_CACHE_LIMIT = 64;
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function messageText(message: string | ArrayBuffer): string | null {
  if (typeof message === 'string') return message.length <= MAX_WS_MESSAGE_BYTES ? message : null;
  if (message.byteLength > MAX_WS_MESSAGE_BYTES) return null;
  return new TextDecoder().decode(message);
}

function protocolError(ws: WebSocket, message: string): void {
  try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* socket closing */ }
}

async function replayStorageKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `move-replay:${hex}`;
}

/**
 * Protocol hardening around the existing ChessRoom authority.
 *
 * The base room remains the single source of truth for chessops legality,
 * side-to-move checks, clocks, FEN/SAN, result adjudication and broadcasting.
 * This wrapper adds at-most-once move command handling and guarantees that an
 * optimistic client receives a canonical snapshot after any rejected move.
 */
export class AuthoritativeChessRoom extends BaseChessRoom {
  private canonicalSnapshot(ws: WebSocket, token: string): void {
    // sendSnapshot is intentionally private in the base room. This wrapper is
    // kept at the transport boundary and invokes it only to reconcile a client
    // after a rejected optimistic command; it never mutates canonical state.
    const room = this as unknown as { sendSnapshot: (socket: WebSocket, seatToken: string) => void };
    try { room.sendSnapshot(ws, token); } catch { /* socket closing */ }
  }

  private rejectMove(ws: WebSocket, token: string | null, message: string): void {
    protocolError(ws, message);
    if (token) this.canonicalSnapshot(ws, token);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = messageText(message);
    if (text === null) {
      protocolError(ws, 'Realtime command is too large.');
      return;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch {
      protocolError(ws, 'Unreadable command.');
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      protocolError(ws, 'Invalid realtime command.');
      return;
    }

    const payload = parsed as Record<string, unknown>;
    if (payload.type !== 'move') {
      await super.webSocketMessage(ws, text);
      return;
    }

    const move = payload as MoveEnvelope;
    const attachment = ws.deserializeAttachment() as SeatAttachment | null;
    const token = typeof attachment?.token === 'string' ? attachment.token : null;
    const uci = typeof move.uci === 'string' ? move.uci.trim().toLowerCase() : '';
    const sequence = move.clientSequence;
    const sentAt = move.clientSentAt;

    if (!token) {
      protocolError(ws, 'Your room seat is no longer valid.');
      return;
    }
    if (!UCI_MOVE.test(uci)) {
      this.rejectMove(ws, token, 'Invalid move format.');
      return;
    }
    if (!Number.isSafeInteger(sequence) || Number(sequence) <= 0 || !Number.isFinite(sentAt) || Number(sentAt) <= 0) {
      this.rejectMove(ws, token, 'Move command is missing its replay-protection metadata.');
      return;
    }

    // The exact client command is an idempotency key. It survives WebSocket
    // reconnects and Durable Object hibernation, while allowing a freshly
    // generated command after a reload because clientSentAt changes.
    const replayKey = `${Number(sequence)}:${Math.trunc(Number(sentAt))}:${uci}`;
    const storageKey = await replayStorageKey(token);
    const ctx = (this as unknown as { ctx: DurableObjectState }).ctx;
    const recent = await ctx.storage.get<string[]>(storageKey) ?? [];
    if (recent.includes(replayKey)) {
      this.rejectMove(ws, token, 'Duplicate or replayed move ignored.');
      return;
    }
    await ctx.storage.put(storageKey, [...recent, replayKey].slice(-REPLAY_CACHE_LIMIT));

    // Chessground animates the drop immediately. The base room now decides
    // whether it is canonical. If it rejects the move, force a snapshot so the
    // board/FEN/turn/clocks snap back to the server truth immediately.
    const internalBefore = this as unknown as { room: { session?: { moveNumber?: number } } | null };
    const beforeMoveNumber = internalBefore.room?.session?.moveNumber ?? -1;
    await super.webSocketMessage(ws, text);
    const internalAfter = this as unknown as { room: { session?: { moveNumber?: number } } | null };
    const afterMoveNumber = internalAfter.room?.session?.moveNumber ?? -1;
    if (afterMoveNumber === beforeMoveNumber) this.canonicalSnapshot(ws, token);
  }
}
