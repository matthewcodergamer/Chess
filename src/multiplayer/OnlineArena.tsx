import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api as ChessgroundApi } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { parseFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';
import { celebratePurchase } from '../ui/purchaseCelebration';
import { createCheckout, loadTournamentCatalog, type PaymentMode } from '../tournaments/client';
import { createRoom, joinRoom, connectRoom, multiplayerConfigured } from './client';
import type { CoinFace, RoomSeat, RoomSnapshot, ServerEvent } from './types';

const promotionLetters = ['q', 'r', 'b', 'n'] as const;
type PromotionLetter = typeof promotionLetters[number];
type Props = { onClose: () => void };

function formatClockMs(value: number): string {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function money(cents: number): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }
function roomPosition(snapshot: RoomSnapshot | null): Chess | null {
  if (!snapshot) return null;
  try { return Chess.fromSetup(parseFen(snapshot.fen).unwrap()).unwrap(); } catch { return null; }
}
function seatStorageKey(code: string): string { return `qqurz:room-seat:${code.toUpperCase()}`; }
function loadSeat(code: string): RoomSeat | null {
  if (!code) return null;
  try {
    const raw = window.sessionStorage.getItem(seatStorageKey(code)); if (!raw) return null;
    const parsed = JSON.parse(raw) as RoomSeat;
    if (parsed.code?.toUpperCase() !== code.toUpperCase() || !parsed.token || !parsed.color) return null;
    return { ...parsed, code: parsed.code.toUpperCase() };
  } catch { return null; }
}
function rememberSeat(seat: RoomSeat): void { try { window.sessionStorage.setItem(seatStorageKey(seat.code), JSON.stringify(seat)); } catch { /* optional */ } }
function inviteUrl(code: string): string { const url = new URL(window.location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', code.toUpperCase()); return url.toString(); }

export default function OnlineArena({ onClose }: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const ground = useRef<ChessgroundApi | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});
  const bidClaimSent = useRef('');
  const bidCelebrated = useRef(false);

  const params = new URLSearchParams(window.location.search);
  const queryRoom = params.get('room')?.toUpperCase() ?? '';
  const returnedBidSession = params.get('checkout') === 'success' && params.get('kind') === 'position_bid' ? params.get('session_id') ?? '' : '';

  const [name, setName] = useState('Guest');
  const [roomCode, setRoomCode] = useState(queryRoom);
  const [seat, setSeat] = useState<RoomSeat | null>(() => loadSeat(queryRoom));
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(Date.now());
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'connected' | 'closed' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [bidBusy, setBidBusy] = useState(0);
  const [pendingPromotion, setPendingPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('off');
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [livePositionBidsEnabled, setLivePositionBidsEnabled] = useState(false);

  const pos = useMemo(() => roomPosition(snapshot), [snapshot]);
  const yourTurn = Boolean(seat && snapshot && snapshot.status === 'playing' && snapshot.turn === seat.color && !snapshot.result);
  const elapsedSinceSnapshot = snapshot ? Math.max(0, now - snapshotReceivedAt) : 0;
  const liveStrategySeconds = snapshot?.strategyEndsAt ? Math.max(0, Math.ceil((snapshot.strategyEndsAt - snapshot.serverNow - elapsedSinceSnapshot) / 1000)) : 0;
  const liveWhiteClockMs = snapshot ? Math.max(0, snapshot.whiteClockMs - (snapshot.status === 'playing' && snapshot.turn === 'white' ? elapsedSinceSnapshot : 0)) : 0;
  const liveBlackClockMs = snapshot ? Math.max(0, snapshot.blackClockMs - (snapshot.status === 'playing' && snapshot.turn === 'black' ? elapsedSinceSnapshot : 0)) : 0;

  const send = useCallback((payload: unknown) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(payload)); }, []);

  useEffect(() => {
    loadTournamentCatalog().then(catalog => {
      setPaymentMode(catalog.paymentMode); setPaymentConfigured(catalog.paymentConfigured); setLivePositionBidsEnabled(Boolean(catalog.livePositionBidsEnabled));
    }).catch(() => setPaymentConfigured(false));
  }, []);

  const syncBoard = useCallback(() => {
    if (!ground.current || !snapshot || !pos) return;
    ground.current.set({
      fen: snapshot.fen, orientation: seat?.color ?? 'white', turnColor: snapshot.turn, check: false,
      animation: { enabled: true, duration: 160 }, draggable: { enabled: yourTurn, autoDistance: true, showGhost: true }, selectable: { enabled: yourTurn },
      movable: { free: false, color: yourTurn ? snapshot.turn : undefined, dests: yourTurn ? chessgroundDests(pos, { chess960: true }) : new Map(), showDests: false, rookCastle: true },
    });
  }, [pos, seat?.color, snapshot, yourTurn]);

  const handleMove = useCallback((orig: Key, dest: Key) => {
    if (!yourTurn || !pos) { requestAnimationFrame(syncBoard); return; }
    const from = parseSquare(orig); const piece = from === undefined ? undefined : pos.board.get(from);
    if (piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) { setPendingPromotion({ orig, dest }); requestAnimationFrame(syncBoard); return; }
    send({ type: 'move', uci: `${orig}${dest}` });
  }, [pos, send, syncBoard, yourTurn]);
  moveHandler.current = handleMove;

  useEffect(() => {
    if (!seat) return;
    rememberSeat(seat); setMessage('');
    const ws = connectRoom(seat, (event: ServerEvent) => {
      if (event.type === 'snapshot') {
        const receivedAt = Date.now(); setSnapshot(event.room); setSnapshotReceivedAt(receivedAt); setNow(receivedAt);
        if (event.room.yourColor) setSeat(current => {
          if (!current || current.color === event.room.yourColor) return current;
          const updated: RoomSeat = { ...current, color: event.room.yourColor! }; rememberSeat(updated); return updated;
        });
      } else setMessage(event.message);
    }, status => setConnection(status === 'closed' ? 'closed' : status));
    socket.current = ws;
    return () => { ws.close(); if (socket.current === ws) socket.current = null; };
  }, [seat?.code, seat?.token]);

  useEffect(() => {
    if (connection !== 'connected' || !returnedBidSession || bidClaimSent.current === returnedBidSession) return;
    bidClaimSent.current = returnedBidSession; send({ type: 'claim_position_bid', sessionId: returnedBidSession });
    const url = new URL(window.location.href); ['checkout', 'kind', 'item', 'session_id'].forEach(key => url.searchParams.delete(key)); window.history.replaceState({}, '', url);
    setMessage('Verifying your paid position bid with the room server…');
  }, [connection, returnedBidSession, send]);

  useEffect(() => {
    if (!snapshot || !returnedBidSession || !snapshot.auction.yourBidCents) return;
    if (!bidCelebrated.current) { bidCelebrated.current = true; celebratePurchase(); }
    setMessage(`Verified bid: ${money(snapshot.auction.yourBidCents)}. The room bid table is updated.`);
  }, [returnedBidSession, snapshot?.auction.yourBidCents]);

  useEffect(() => {
    if (!snapshot || !['coin', 'strategy', 'playing'].includes(snapshot.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200); return () => window.clearInterval(timer);
  }, [snapshot?.status]);

  useEffect(() => {
    if (!boardRef.current || !snapshot) return;
    ground.current?.destroy();
    ground.current = Chessground(boardRef.current, {
      orientation: seat?.color ?? 'white', coordinates: true, coordinatesOnSquares: true, blockTouchScroll: true, disableContextMenu: true, autoCastle: true,
      movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
    });
    syncBoard(); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => ground.current?.redrawAll()) : null; observer?.observe(boardRef.current);
    return () => { observer?.disconnect(); ground.current?.destroy(); ground.current = null; };
  }, [snapshot?.code]);
  useEffect(() => syncBoard(), [syncBoard]);

  const setRoomInUrl = (code: string) => { const url = new URL(window.location.href); url.searchParams.set('room', code.toUpperCase()); window.history.replaceState({}, '', url); };
  const create = async () => { setBusy(true); setMessage(''); try { const created = await createRoom(name.trim() || 'Guest'); setRoomCode(created.code); rememberSeat(created); setSeat(created); setRoomInUrl(created.code); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create room.'); } finally { setBusy(false); } };
  const join = async () => { const code = roomCode.trim().toUpperCase(); if (!code) return setMessage('Enter a room code first.'); setBusy(true); setMessage(''); try { const joined = await joinRoom(code, name.trim() || 'Guest'); rememberSeat(joined); setSeat(joined); setRoomInUrl(joined.code); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not join room.'); } finally { setBusy(false); } };
  const copyInvite = async () => { if (!seat) return; const value = inviteUrl(seat.code); try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { setMessage(`Invite link: ${value}`); } };
  const choosePromotion = (promotion: PromotionLetter) => { if (!pendingPromotion) return; const { orig, dest } = pendingPromotion; setPendingPromotion(null); send({ type: 'move', uci: `${orig}${dest}${promotion}` }); };
  const callCoin = (face: CoinFace) => { setMessage(`Calling ${face}… first accepted call gets the choice.`); send({ type: 'call_coin', face }); };
  const buyBid = async (cents: 200 | 500) => {
    if (!seat) return; setBidBusy(cents); setMessage('Opening secure checkout for the position bid…');
    try { const url = await createCheckout(`position-bid-${cents}`, 'position_bid', { roomCode: seat.code }); window.location.assign(url); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start the position-bid checkout.'); setBidBusy(0); }
  };
  const canLeave = snapshot?.status !== 'playing';
  const bidAllowed = Boolean(snapshot && (snapshot.status === 'coin' || snapshot.status === 'strategy'));
  const bidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || livePositionBidsEnabled);

  if (!seat) return (
    <section className="online-lobby-panel" aria-label="Online multiplayer lobby">
      <div className="online-lobby-heading"><div><span className="eyebrow">ONLINE MULTIPLAYER</span><h3>Play across different internet connections</h3><p>Create a private room, share the six-character code, then QQURZ runs the color toss, shared Chess960 position and clocks on the server.</p></div><span className={`server-readiness ${multiplayerConfigured ? 'configured' : ''}`}>{multiplayerConfigured ? 'Server configured' : 'Backend connection required'}</span></div>
      <label className="online-field"><span>Your display name</span><input value={name} maxLength={28} onChange={event => setName(event.target.value)} placeholder="Player name" /></label>
      <div className="online-actions-grid"><button className="online-primary" onClick={create} disabled={!multiplayerConfigured || busy}>{busy ? 'Working…' : 'Create private room'}</button><div className="join-room-box"><input value={roomCode} onChange={event => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="ROOM CODE" aria-label="Room code"/><button onClick={join} disabled={!multiplayerConfigured || busy}>Join</button></div></div>
      {message && <p className="online-error">{message}</p>}<button className="online-back" onClick={onClose}>Back to match choices</button>
    </section>
  );

  return (
    <section className="online-room-shell">
      <header className="online-room-header"><div><span className="eyebrow">LIVE ROOM</span><strong>{seat.code}</strong><small>{connection === 'connected' ? '● Connected' : `● ${connection}`}</small></div><div className="online-header-actions"><button className="invite-link-button" onClick={copyInvite}>{copied ? 'Copied ✓' : 'Copy invite link'}</button>{canLeave ? <button onClick={onClose}>Leave room</button> : <span className="game-locked-pill">Game locked in progress</span>}</div></header>
      {snapshot ? <div className="online-game-grid">
        <div className="online-board-column">
          <div className="board-frame online-board-frame no-free-hints">
            <div ref={boardRef} className="cg-wrap board-mount" aria-label="Online Chess960 board" />
            {snapshot.status === 'waiting' && <div className="board-overlay online-waiting-overlay"><div><span>WAITING FOR OPPONENT</span><strong className="room-code-display">{snapshot.code}</strong><small>Share this code or invite link with player two.</small></div></div>}
            {snapshot.status === 'coin' && <div className="board-overlay coin-overlay"><div className="coin-stage">
              <span>COLOR TOSS · U.S. QUARTER</span>
              <div className={`qqurz-quarter ${snapshot.coin.result ? `flipping result-${snapshot.coin.result}` : ''}`} aria-label="3D quarter coin toss"><div className="coin-face coin-heads"><b>HEADS</b><span className="coin-profile">W</span><small>WASHINGTON</small></div><div className="coin-face coin-tails"><b>TAILS</b><span className="coin-eagle">25¢</span><small>QUARTER</small></div></div>
              {!snapshot.coin.result ? <><strong>First accepted call chooses the side.</strong><p>The other player automatically gets the opposite face. The toss winner receives White.</p><div className="coin-call-actions"><button onClick={() => callCoin('heads')}>Call Heads</button><button onClick={() => callCoin('tails')}>Call Tails</button></div></> : <><strong>{snapshot.coin.result.toUpperCase()} · {snapshot.coin.winner} gets White</strong><p>You called {snapshot.coin.yourFace ?? '—'} · your assigned color is {snapshot.yourColor ?? seat.color}.</p></>}
            </div></div>}
            {snapshot.status === 'strategy' && <div className="board-overlay strategy-overlay online-strategy-overlay"><div><span>STRATEGY PHASE</span><strong>{formatClockMs(liveStrategySeconds * 1000)}</strong><small>No tactical warnings or legal-move dots are shown in standard play.</small><button className="overlay-start-button" onClick={() => send({ type: 'start_now' })}>Start Now</button></div></div>}
            {snapshot.status === 'ended' && snapshot.result && <div className="board-overlay ended online-ended-overlay"><div><span>GAME OVER</span><strong className="end-title">{snapshot.result}</strong></div></div>}
          </div>
          <div className="online-clock-row"><div className={snapshot.turn === 'white' && snapshot.status === 'playing' ? 'active' : ''}><span>White · {snapshot.players.white?.name ?? 'Waiting'}</span><strong>{formatClockMs(liveWhiteClockMs)}</strong></div><div className={snapshot.turn === 'black' && snapshot.status === 'playing' ? 'active' : ''}><span>Black · {snapshot.players.black?.name ?? 'Waiting'}</span><strong>{formatClockMs(liveBlackClockMs)}</strong></div></div>
          {bidAllowed && <section className="position-auction-card"><div><span className="eyebrow">POSITION REROLL BID</span><h3>Highest verified bid controls the next shared shuffle.</h3><p>QQURZ uses all 960 legal Chess960 starts. A new highest verified bid rerolls the same board for both players; equal bids keep the earlier leader.</p></div><div className="auction-status"><span>Leader</span><b>{snapshot.auction.leaderName ?? 'No bid yet'}</b><span>Top bid</span><b>{snapshot.auction.leadingBidCents ? money(snapshot.auction.leadingBidCents) : '—'}</b><span>Your verified bid</span><b>{snapshot.auction.yourBidCents ? money(snapshot.auction.yourBidCents) : '—'}</b></div><div className="auction-actions"><button onClick={() => buyBid(200)} disabled={!bidPaymentsAvailable || Boolean(bidBusy)}>{bidBusy === 200 ? 'Opening…' : 'Bid $2 & reroll'}</button><button onClick={() => buyBid(500)} disabled={!bidPaymentsAvailable || Boolean(bidBusy)}>{bidBusy === 500 ? 'Opening…' : 'Bid $5 & reroll'}</button></div><small>{paymentMode === 'test' ? 'Stripe test mode: no real money moves.' : livePositionBidsEnabled ? 'Live position bidding enabled by server policy.' : 'Live position bidding is disabled by default; test mode is required.'}</small></section>}
          {snapshot.status === 'playing' && <div className="online-in-game-actions"><div className="online-turn-note">{yourTurn ? 'Your move' : 'Opponent’s move'}</div><button className="resign-button" onClick={() => send({ type: 'resign' })}>Resign</button></div>}
          {message && <p className="online-error">{message}</p>}
        </div>
        <aside className="online-room-side"><span className="eyebrow">ROOM DETAILS</span><h3>Position #{snapshot.positionId}</h3><div className="seat-list"><div><span className="seat-dot white"/>White <b>{snapshot.players.white?.name ?? 'Open seat'}{snapshot.players.white?.connected ? ' · online' : ''}</b></div><div><span className="seat-dot black"/>Black <b>{snapshot.players.black?.name ?? 'Open seat'}{snapshot.players.black?.connected ? ' · online' : ''}</b></div></div><div className="move-count-card"><span>Moves</span><strong>{snapshot.moves.length}</strong></div><p className="server-authority-note">Moves and results stay server-validated. You can hang a queen or make any other legal blunder; QQURZ does not block mistakes or show free tactical warnings.</p></aside>
      </div> : <div className="online-connecting-state">Connecting to room {seat.code}…</div>}
      {pendingPromotion && <div className="online-promotion" role="dialog" aria-label="Choose online promotion piece"><div><b>Promote pawn</b><button onClick={() => choosePromotion('q')}>♕ Queen</button><button onClick={() => choosePromotion('r')}>♖ Rook</button><button onClick={() => choosePromotion('b')}>♗ Bishop</button><button onClick={() => choosePromotion('n')}>♘ Knight</button></div></div>}
    </section>
  );
}
