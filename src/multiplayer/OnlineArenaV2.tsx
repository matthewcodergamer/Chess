import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api as ChessgroundApi } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { parseFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';
import { celebratePurchase } from '../ui/purchaseCelebration';
import QuarterCoin from '../ui/QuarterCoin';
import { playChessSound } from '../ui/sound';
import { createCheckout, loadTournamentCatalog, type BidColor, type PaymentMode } from '../tournaments/client';
import { connectRoom, createRoom, joinRoom, multiplayerConfigured } from './client';
import type { CoinFace, RoomSeat, RoomSnapshot, ServerEvent } from './types';

type PromotionLetter = 'q' | 'r' | 'b' | 'n';
type Props = { onClose: () => void; variant?: 'friends' | 'tournament' };

function formatClockMs(value: number): string {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
function roomPosition(snapshot: RoomSnapshot | null): Chess | null {
  if (!snapshot) return null;
  try { return Chess.fromSetup(parseFen(snapshot.fen).unwrap()).unwrap(); } catch { return null; }
}
function seatKey(code: string): string { return `qqurz:room-seat:${code.toUpperCase()}`; }
function loadSeat(code: string): RoomSeat | null {
  if (!code) return null;
  try {
    const raw = sessionStorage.getItem(seatKey(code));
    if (!raw) return null;
    const seat = JSON.parse(raw) as RoomSeat;
    return seat.code?.toUpperCase() === code.toUpperCase() && seat.token && seat.color
      ? { ...seat, code: seat.code.toUpperCase() }
      : null;
  } catch { return null; }
}
function rememberSeat(seat: RoomSeat): void {
  try { sessionStorage.setItem(seatKey(seat.code), JSON.stringify(seat)); } catch { /* optional */ }
}
function profileName(): string {
  try {
    const raw = localStorage.getItem('qqurz:profile');
    const value = raw ? JSON.parse(raw) as { username?: string } : null;
    return value?.username?.trim() || 'Guest';
  } catch { return 'Guest'; }
}
function inviteUrl(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code.toUpperCase());
  return url.toString();
}
function cleanCheckoutQuery(): void {
  const url = new URL(location.href);
  ['checkout', 'kind', 'item', 'session_id'].forEach(key => url.searchParams.delete(key));
  history.replaceState({}, '', url);
}

export default function OnlineArenaV2({ onClose, variant = 'friends' }: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const ground = useRef<ChessgroundApi | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});
  const colorBidClaimSent = useRef('');
  const bidCelebrated = useRef(false);
  const lastMoveSoundCount = useRef(0);
  const lastCoinResult = useRef<CoinFace | null>(null);
  const lastAwaitingPress = useRef<'white' | 'black' | null>(null);
  const lastResult = useRef<string | null>(null);

  const params = new URLSearchParams(location.search);
  const queryRoom = params.get('room')?.toUpperCase() ?? '';
  const returnedColorBidSession = params.get('checkout') === 'success' && params.get('kind') === 'color_bid'
    ? params.get('session_id') ?? ''
    : '';
  const returnedLegacyPositionBid = params.get('checkout') === 'success' && params.get('kind') === 'position_bid';

  const [name, setName] = useState(profileName);
  const [roomCode, setRoomCode] = useState(queryRoom);
  const [seat, setSeat] = useState<RoomSeat | null>(() => loadSeat(queryRoom));
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [snapshotAt, setSnapshotAt] = useState(Date.now());
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'connected' | 'closed' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [bidBusy, setBidBusy] = useState(false);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('off');
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [liveColorBidsEnabled, setLiveColorBidsEnabled] = useState(false);
  const [colorBidMinCents, setColorBidMinCents] = useState(100);
  const [colorBidMaxCents, setColorBidMaxCents] = useState(10000);
  const [bidColor, setBidColor] = useState<BidColor>('white');
  const [bidAmount, setBidAmount] = useState('2.00');

  const pos = useMemo(() => roomPosition(snapshot), [snapshot]);
  const yourTurn = Boolean(seat && snapshot && snapshot.status === 'playing' && !snapshot.awaitingClockPress && snapshot.turn === seat.color && !snapshot.result);
  const elapsed = snapshot ? Math.max(0, now - snapshotAt) : 0;
  const strategySeconds = snapshot?.strategyEndsAt ? Math.max(0, Math.ceil((snapshot.strategyEndsAt - snapshot.serverNow - elapsed) / 1000)) : 0;
  const whiteMs = snapshot ? Math.max(0, snapshot.whiteClockMs - (snapshot.status === 'playing' && snapshot.activeClock === 'white' ? elapsed : 0)) : 0;
  const blackMs = snapshot ? Math.max(0, snapshot.blackClockMs - (snapshot.status === 'playing' && snapshot.activeClock === 'black' ? elapsed : 0)) : 0;

  const send = useCallback((payload: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(payload));
  }, []);

  useEffect(() => {
    loadTournamentCatalog().then(catalog => {
      setPaymentMode(catalog.paymentMode);
      setPaymentConfigured(catalog.paymentConfigured);
      setLiveColorBidsEnabled(Boolean(catalog.livePositionBidsEnabled));
      setColorBidMinCents(catalog.colorBidMinCents ?? 100);
      setColorBidMaxCents(catalog.colorBidMaxCents ?? 10000);
    }).catch(() => setPaymentConfigured(false));
  }, []);

  const syncBoard = useCallback(() => {
    if (!ground.current || !snapshot || !pos) return;
    ground.current.set({
      fen: snapshot.fen,
      orientation: seat?.color ?? 'white',
      turnColor: snapshot.turn,
      check: false,
      animation: { enabled: true, duration: 160 },
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
  }, [pos, seat?.color, snapshot, yourTurn]);

  const handleMove = useCallback((orig: Key, dest: Key) => {
    if (!yourTurn || !pos) return requestAnimationFrame(syncBoard);
    const from = parseSquare(orig);
    const piece = from === undefined ? undefined : pos.board.get(from);
    if (piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) {
      setPromotion({ orig, dest });
      return requestAnimationFrame(syncBoard);
    }
    send({ type: 'move', uci: `${orig}${dest}` });
  }, [pos, send, syncBoard, yourTurn]);
  moveHandler.current = handleMove;

  useEffect(() => {
    if (!seat) return;
    rememberSeat(seat);
    setMessage('');
    const ws = connectRoom(seat, (event: ServerEvent) => {
      if (event.type === 'error') { setMessage(event.message); return; }
      if (event.type === 'notice') { setMessage(event.message); return; }
      const receivedAt = Date.now();
      setSnapshot(event.room);
      setSnapshotAt(receivedAt);
      setNow(receivedAt);
      if (event.room.yourColor) {
        setSeat(current => {
          if (!current || current.color === event.room.yourColor) return current;
          const updated: RoomSeat = { ...current, color: event.room.yourColor! };
          rememberSeat(updated);
          return updated;
        });
      }
    }, status => setConnection(status === 'closed' ? 'closed' : status));
    socket.current = ws;
    return () => { ws.close(); if (socket.current === ws) socket.current = null; };
  }, [seat?.code, seat?.token]);

  useEffect(() => {
    if (connection !== 'connected' || !returnedColorBidSession || colorBidClaimSent.current === returnedColorBidSession) return;
    colorBidClaimSent.current = returnedColorBidSession;
    send({ type: 'claim_color_bid', sessionId: returnedColorBidSession });
    cleanCheckoutQuery();
    setMessage('Verifying your paid color bid and settling any automatic refund…');
  }, [connection, returnedColorBidSession, send]);

  useEffect(() => {
    if (!returnedLegacyPositionBid) return;
    cleanCheckoutQuery();
    setMessage('Position reroll bidding has been replaced. QQURZ now lets both players bid for White or Black, and losing paid bids are refunded.');
  }, [returnedLegacyPositionBid]);

  useEffect(() => {
    if (!snapshot || !returnedColorBidSession || !snapshot.auction.yourBidCents) return;
    if (snapshot.auction.yourBidRefunded) {
      setMessage(`Your ${snapshot.auction.yourBidColor ?? ''} bid of ${money(snapshot.auction.yourBidCents)} was refunded because it did not remain the highest bid.`);
      return;
    }
    if (snapshot.auction.yourBidCents === snapshot.auction.leadingBidCents) {
      if (!bidCelebrated.current) { bidCelebrated.current = true; celebratePurchase(); }
      setMessage(`You currently lead at ${money(snapshot.auction.yourBidCents)} for ${snapshot.auction.yourBidColor}.`);
    }
  }, [returnedColorBidSession, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.moves.length > lastMoveSoundCount.current) {
      playChessSound((snapshot.moves.at(-1) ?? '').includes('x') ? 'capture' : 'move');
      lastMoveSoundCount.current = snapshot.moves.length;
    }
    if (snapshot.coin.result && snapshot.coin.result !== lastCoinResult.current) {
      playChessSound('coin');
      lastCoinResult.current = snapshot.coin.result;
    }
    if (lastAwaitingPress.current && !snapshot.awaitingClockPress) playChessSound('slap');
    lastAwaitingPress.current = snapshot.awaitingClockPress;
    if (snapshot.result && snapshot.result !== lastResult.current) {
      playChessSound('win');
      lastResult.current = snapshot.result;
    }
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot || !['coin', 'strategy', 'playing'].includes(snapshot.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [snapshot?.status]);

  useEffect(() => {
    if (!boardRef.current || !snapshot) return;
    ground.current?.destroy();
    ground.current = Chessground(boardRef.current, {
      orientation: seat?.color ?? 'white',
      coordinates: true,
      coordinatesOnSquares: true,
      blockTouchScroll: true,
      disableContextMenu: true,
      autoCastle: true,
      movable: {
        free: false,
        rookCastle: true,
        events: { after: (orig, dest) => moveHandler.current(orig, dest) },
      },
    });
    syncBoard();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => ground.current?.redrawAll()) : null;
    observer?.observe(boardRef.current);
    return () => {
      observer?.disconnect();
      ground.current?.destroy();
      ground.current = null;
    };
  }, [snapshot?.code]);
  useEffect(() => syncBoard(), [syncBoard]);

  const setRoomUrl = (code: string) => {
    const url = new URL(location.href);
    url.searchParams.set('room', code.toUpperCase());
    history.replaceState({}, '', url);
  };
  const create = async () => {
    setBusy(true); setMessage('');
    try {
      const created = await createRoom(name.trim() || 'Guest');
      setRoomCode(created.code); rememberSeat(created); setSeat(created); setRoomUrl(created.code);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create room.');
    } finally { setBusy(false); }
  };
  const join = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return setMessage('Enter a room code first.');
    setBusy(true); setMessage('');
    try {
      const joined = await joinRoom(code, name.trim() || 'Guest');
      rememberSeat(joined); setSeat(joined); setRoomUrl(joined.code);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not join room.');
    } finally { setBusy(false); }
  };
  const copyInvite = async () => {
    if (!seat) return;
    const value = inviteUrl(seat.code);
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch { setMessage(`Invite link: ${value}`); }
  };
  const choosePromotion = (piece: PromotionLetter) => {
    if (!promotion) return;
    send({ type: 'move', uci: `${promotion.orig}${promotion.dest}${piece}` });
    setPromotion(null);
  };
  const buyColorBid = async () => {
    if (!seat) return;
    const cents = Math.round(Number(bidAmount) * 100);
    if (!Number.isFinite(cents) || cents < colorBidMinCents || cents > colorBidMaxCents) {
      setMessage(`Enter a bid from ${money(colorBidMinCents)} to ${money(colorBidMaxCents)}.`);
      return;
    }
    if (snapshot?.auction.leadingBidCents && cents <= snapshot.auction.leadingBidCents) {
      setMessage(`To take the lead, your bid must be higher than ${money(snapshot.auction.leadingBidCents)}.`);
      return;
    }
    setBidBusy(true);
    setMessage(`Opening secure checkout for a ${money(cents)} ${bidColor} bid…`);
    try {
      const url = await createCheckout('color-bid', 'color_bid', { roomCode: seat.code, desiredColor: bidColor, bidCents: cents });
      location.assign(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start color-bid checkout.');
      setBidBusy(false);
    }
  };

  const canLeave = snapshot?.status !== 'playing';
  const bidAllowed = Boolean(snapshot && (snapshot.status === 'coin' || snapshot.status === 'strategy'));
  const colorBidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || liveColorBidsEnabled);

  if (!seat) return (
    <section className="online-lobby-panel" aria-label="Online multiplayer lobby">
      <div className="online-lobby-heading">
        <div>
          <span className="eyebrow">ONLINE MULTIPLAYER</span>
          <h3>{variant === 'tournament' ? 'Enter the QQURZ tournament room' : 'Play across different internet connections'}</h3>
          <p>Create or join a six-character room. QQURZ keeps the quarter toss, shared Chess960 position, color assignment and clock state on the server.</p>
        </div>
        <span className={`server-readiness ${multiplayerConfigured ? 'configured' : ''}`}>{multiplayerConfigured ? 'Server configured' : 'Backend connection required'}</span>
      </div>
      <label className="online-field"><span>Your display name</span><input value={name} maxLength={28} onChange={event => setName(event.target.value)} placeholder="Player name" /></label>
      <div className="online-actions-grid">
        <button className="online-primary" onClick={create} disabled={!multiplayerConfigured || busy}>{busy ? 'Working…' : 'Create private room'}</button>
        <div className="join-room-box"><input value={roomCode} onChange={event => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="ROOM CODE"/><button onClick={join} disabled={!multiplayerConfigured || busy}>Join</button></div>
      </div>
      {message && <p className="online-error">{message}</p>}
      <button className="online-back" onClick={onClose}>Back to match choices</button>
    </section>
  );

  return (
    <section className="online-room-shell">
      <header className="online-room-header">
        <div><span className="eyebrow">{variant === 'tournament' ? 'QQURZ TOURNAMENT ROOM' : 'LIVE ROOM'}</span><strong>{seat.code}</strong><small>{connection === 'connected' ? '● Connected' : `● ${connection}`}</small></div>
        <div className="online-header-actions"><button className="invite-link-button" onClick={copyInvite}>{copied ? 'Copied ✓' : 'Copy invite link'}</button>{canLeave ? <button onClick={onClose}>Leave room</button> : <span className="game-locked-pill">Game locked in progress</span>}</div>
      </header>

      {snapshot ? <div className="online-game-grid">
        <div className="online-board-column">
          <div className={`board-frame online-board-frame ${variant === 'tournament' ? 'tournament-green-board' : ''}`}>
            <div ref={boardRef} className="cg-wrap board-mount" aria-label="Online Chess960 board" />

            {snapshot.status === 'waiting' && <div className="board-overlay online-waiting-overlay"><div><span>WAITING FOR OPPONENT</span><strong className="room-code-display">{snapshot.code}</strong><small>Share this code or invite link with player two.</small></div></div>}

            {snapshot.status === 'coin' && <div className="board-overlay coin-overlay">
              <div className="coin-stage">
                <span>COLOR TOSS · U.S. QUARTER</span>
                <QuarterCoin result={snapshot.coin.result} />
                {!snapshot.coin.result ? <>
                  <strong>Call the quarter.</strong>
                  <p>{snapshot.auction.leaderName ? `The paid color leader currently holds ${snapshot.auction.leaderColor}; the physical toss still runs, but it will not overwrite that verified color choice.` : 'With no paid color leader, the toss winner receives White.'}</p>
                  <div className="coin-call-actions"><button onClick={() => send({ type: 'call_coin', face: 'heads' })}>Call Heads</button><button onClick={() => send({ type: 'call_coin', face: 'tails' })}>Call Tails</button></div>
                </> : <>
                  <strong>{snapshot.coin.result.toUpperCase()} · toss won by {snapshot.coin.winner}</strong>
                  <p>{snapshot.auction.leaderName ? `${snapshot.auction.leaderName} keeps ${snapshot.auction.leaderColor} as the highest verified color bidder.` : `${snapshot.coin.winner} receives White. You called ${snapshot.coin.yourFace ?? '—'} and your assigned color is ${snapshot.yourColor ?? seat.color}.`}</p>
                </>}
              </div>
            </div>}

            {snapshot.status === 'strategy' && <div className="board-overlay strategy-overlay online-strategy-overlay"><div><span>STRATEGY PHASE</span><strong>{formatClockMs(strategySeconds * 1000)}</strong><small>Green dots show legal destinations. Tactical danger warnings stay off, so players can still blunder.</small><button className="overlay-start-button" onClick={() => { playChessSound('start'); send({ type: 'start_now' }); }}>Start Now</button></div></div>}
            {snapshot.status === 'ended' && snapshot.result && <div className="board-overlay ended online-ended-overlay"><div><span>GAME OVER</span><strong className="end-title">{snapshot.result}</strong></div></div>}
          </div>

          <div className="online-clock-row"><div className={snapshot.activeClock === 'white' && snapshot.status === 'playing' ? 'active' : ''}><span>White · {snapshot.players.white?.name ?? 'Waiting'}</span><strong>{formatClockMs(whiteMs)}</strong></div><div className={snapshot.activeClock === 'black' && snapshot.status === 'playing' ? 'active' : ''}><span>Black · {snapshot.players.black?.name ?? 'Waiting'}</span><strong>{formatClockMs(blackMs)}</strong></div></div>

          {bidAllowed && <section className="color-auction-card">
            <div>
              <span className="eyebrow">COLOR CHOICE AUCTION</span>
              <h3>Bid for White or Black.</h3>
              <p>The highest verified bid gets the color they chose. When another player outbids it, the displaced losing charge is automatically refunded through Stripe.</p>
            </div>
            <div className="color-bid-status">
              <span>Leader</span><b>{snapshot.auction.leaderName ?? 'No bid yet'}</b>
              <span>Top bid</span><b>{snapshot.auction.leadingBidCents ? money(snapshot.auction.leadingBidCents) : '—'}</b>
              <span>Winning color</span><b>{snapshot.auction.leaderColor ? snapshot.auction.leaderColor[0].toUpperCase() + snapshot.auction.leaderColor.slice(1) : '—'}</b>
              <span>Your last bid</span><b>{snapshot.auction.yourBidCents ? `${money(snapshot.auction.yourBidCents)} · ${snapshot.auction.yourBidColor}${snapshot.auction.yourBidRefunded ? ' · refunded' : ''}` : '—'}</b>
            </div>
            <div className="color-bid-choice" aria-label="Choose desired chess color"><button className={bidColor === 'white' ? 'selected' : ''} onClick={() => setBidColor('white')}>♙ Bid for White</button><button className={bidColor === 'black' ? 'selected' : ''} onClick={() => setBidColor('black')}>♟ Bid for Black</button></div>
            <div className="color-bid-entry">
              <label className="color-bid-money"><span>$</span><input type="number" inputMode="decimal" min={(colorBidMinCents / 100).toFixed(2)} max={(colorBidMaxCents / 100).toFixed(2)} step="0.01" value={bidAmount} onChange={event => setBidAmount(event.target.value)} aria-label="Color bid amount in US dollars" /></label>
              <button className="online-primary" onClick={buyColorBid} disabled={!colorBidPaymentsAvailable || bidBusy}>{bidBusy ? 'Opening checkout…' : `Bid for ${bidColor === 'white' ? 'White' : 'Black'}`}</button>
            </div>
            <small className="refund-note">{paymentMode === 'test' ? 'Stripe test mode: no real money moves, but the full outbid/refund flow is exercised.' : liveColorBidsEnabled ? 'Live color bidding is enabled. Only the current winning bid is intended to remain charged; outbid/losing verified charges are refunded server-side.' : 'Live paid color bidding is disabled by server policy.'}</small>
          </section>}

          {snapshot.status === 'playing' && <div className="online-in-game-actions"><div className="online-turn-note">{snapshot.awaitingClockPress === seat.color ? 'Move made — slap your clock' : snapshot.awaitingClockPress ? 'Opponent is finishing their move on the clock' : yourTurn ? 'Your move' : 'Opponent’s move'}</div>{snapshot.awaitingClockPress === seat.color && <button className={`clock-slap-inline ${seat.color}`} onClick={() => send({ type: 'clock_slap' })}>SLAP CLOCK</button>}<button className="resign-button" onClick={() => send({ type: 'resign' })}>Resign</button></div>}
          {message && <p className="online-error">{message}</p>}
        </div>

        <aside className="online-room-side"><span className="eyebrow">ROOM DETAILS</span><h3>Position #{snapshot.positionId}</h3><div className="seat-list"><div><span className="seat-dot white"/>White <b>{snapshot.players.white?.name ?? 'Open seat'}{snapshot.players.white?.connected ? ' · online' : ''}</b></div><div><span className="seat-dot black"/>Black <b>{snapshot.players.black?.name ?? 'Open seat'}{snapshot.players.black?.connected ? ' · online' : ''}</b></div></div><div className="move-count-card"><span>Moves</span><strong>{snapshot.moves.length}</strong></div><p className="server-authority-note">Moves, color ownership, paid-bid verification, loser refunds and results are server-authoritative. Green dots show legal moves only.</p></aside>
      </div> : <div className="online-connecting-state">Connecting to room {seat.code}…</div>}

      {promotion && <div className="online-promotion" role="dialog" aria-label="Choose online promotion piece"><div><b>Promote pawn</b><button onClick={() => choosePromotion('q')}>♕ Queen</button><button onClick={() => choosePromotion('r')}>♖ Rook</button><button onClick={() => choosePromotion('b')}>♗ Bishop</button><button onClick={() => choosePromotion('n')}>♘ Knight</button></div></div>}
    </section>
  );
}
