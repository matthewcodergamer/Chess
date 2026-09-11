import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { parseFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';
import { celebratePurchase } from '../ui/purchaseCelebration';
import Quarter3D from '../ui/Quarter3D';
import PhysicalChessClock from '../ui/PhysicalChessClock';
import MatchPlayerBar from '../ui/MatchPlayerBar';
import ChessBoardSurface, { type QQurzChessgroundApi, type QQurzChessgroundConfig } from '../ui/ChessBoardSurface';
import ChessPieceAsset from '../ui/ChessPieceAsset';
import TimeControlPicker from '../ui/TimeControlPicker';
import { clockVisible, setClockVisible, subscribeClockVisible } from '../ui/clockPreference';
import { playChessSound } from '../ui/sound';
import { motionTokenMs, useReducedMotion } from '../ui/motion';
import { createCheckout, loadTournamentCatalog, type PaymentMode } from '../tournaments/client';
import { connectRoom, createRoom, joinRoom, multiplayerConfigured } from './client';
import type { CoinFace, RoomSeat, RoomSnapshot, ServerEvent } from './types';
import { authoritativeRoomSession } from './session';
import { canColorMove, canLeaveGameSession, canOfferDraw, canResignGameSession, clockOwner, isTerminalGameState } from '../../shared/gameSession';
import { TIME_CONTROL_PRESETS, TOURNAMENT_TIME_TEMPLATES, normalizeTimeControl, timeControlLabel, type TimeControl, type TimeControlPresetId, type TournamentTimeTemplateId } from '../../shared/timeControl';

type PromotionLetter = 'q' | 'r' | 'b' | 'n';
type DesiredColor = 'white' | 'black';
type Props = { onClose: () => void; variant?: 'friends' | 'tournament' };

function formatClockMs(value: number): string {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function money(cents: number): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }
function roomPosition(fen: string | undefined): Chess | null {
  if (!fen) return null;
  try { return Chess.fromSetup(parseFen(fen).unwrap()).unwrap(); } catch { return null; }
}
function seatKey(code: string): string { return `qqurz:room-seat:${code.toUpperCase()}`; }
function loadSeat(code: string): RoomSeat | null {
  if (!code) return null;
  try {
    const raw = sessionStorage.getItem(seatKey(code));
    if (!raw) return null;
    const seat = JSON.parse(raw) as RoomSeat;
    return seat.code?.toUpperCase() === code.toUpperCase() && seat.token && seat.color ? { ...seat, code: seat.code.toUpperCase() } : null;
  } catch { return null; }
}
function rememberSeat(seat: RoomSeat): void { try { sessionStorage.setItem(seatKey(seat.code), JSON.stringify(seat)); } catch { /* optional */ } }
function profileName(): string {
  try {
    const raw = localStorage.getItem('qqurz:profile');
    const value = raw ? JSON.parse(raw) as { username?: string } : null;
    return value?.username?.trim() || 'Guest';
  } catch { return 'Guest'; }
}
function tournamentTimePolicy(): { templateId: TournamentTimeTemplateId; allowed: TimeControlPresetId[]; control: TimeControl } {
  const fallback = TOURNAMENT_TIME_TEMPLATES['open-rapid'];
  try {
    const raw = sessionStorage.getItem('qqurz:selected-tournament');
    const selected = raw ? JSON.parse(raw) as { timeControlTemplateId?: TournamentTimeTemplateId; allowedTimeControls?: string[]; baseMinutes?: number; incrementSeconds?: number } : null;
    const template = selected?.timeControlTemplateId && TOURNAMENT_TIME_TEMPLATES[selected.timeControlTemplateId]
      ? TOURNAMENT_TIME_TEMPLATES[selected.timeControlTemplateId]
      : fallback;
    const allowed = (selected?.allowedTimeControls ?? template.allowedControls).filter((id): id is TimeControlPresetId => id in TIME_CONTROL_PRESETS);
    const control = selected?.baseMinutes !== undefined
      ? normalizeTimeControl({ baseMs: selected.baseMinutes * 60_000, incrementMs: (selected.incrementSeconds ?? 0) * 1_000 }, template.defaultControl)
      : { ...TIME_CONTROL_PRESETS[template.defaultControl] };
    return { templateId: template.id, allowed: allowed.length ? allowed : [...template.allowedControls], control };
  } catch { return { templateId: fallback.id, allowed: [...fallback.allowedControls], control: { ...TIME_CONTROL_PRESETS[fallback.defaultControl] } }; }
}

function inviteUrl(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code.toUpperCase());
  return url.toString();
}

export default function OnlineArena({ onClose, variant = 'friends' }: Props) {
  const ground = useRef<QQurzChessgroundApi | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const moveHandler = useRef<(orig: Key, dest: Key) => void>(() => {});
  const bidClaimSent = useRef('');
  const colorBidClaimSent = useRef('');
  const bidCelebrated = useRef(false);
  const colorBidCelebrated = useRef(false);
  const lastMoveSoundCount = useRef(0);
  const lastCoinResult = useRef<CoinFace | null>(null);
  const lastResult = useRef<string | null>(null);
  const moveSequence = useRef(0);

  const params = new URLSearchParams(location.search);
  const queryRoom = params.get('room')?.toUpperCase() ?? '';
  const returnedBidSession = params.get('checkout') === 'success' && params.get('kind') === 'position_bid' ? params.get('session_id') ?? '' : '';
  const returnedColorBidSession = params.get('checkout') === 'success' && params.get('kind') === 'color_bid' ? params.get('session_id') ?? '' : '';
  const returnedColor = params.get('color') === 'black' ? 'black' : 'white';

  const [name, setName] = useState(profileName);
  const [roomCode, setRoomCode] = useState(queryRoom);
  const [seat, setSeat] = useState<RoomSeat | null>(() => loadSeat(queryRoom));
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [snapshotAt, setSnapshotAt] = useState(Date.now());
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'connected' | 'closed' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [bidBusy, setBidBusy] = useState(0);
  const [colorBidBusy, setColorBidBusy] = useState(0);
  const [desiredColor, setDesiredColor] = useState<DesiredColor>(returnedColor);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('off');
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [livePositionBidsEnabled, setLivePositionBidsEnabled] = useState(false);
  const [liveColorBidsEnabled, setLiveColorBidsEnabled] = useState(false);
  const [showClock, setShowClock] = useState(clockVisible);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const tournamentPolicy = useMemo(() => tournamentTimePolicy(), []);
  const [roomTimeControl, setRoomTimeControl] = useState<TimeControl>(() => variant === 'tournament' ? tournamentTimePolicy().control : { ...TIME_CONTROL_PRESETS['10+5'] });
  const reducedMotion = useReducedMotion();
  const pieceMotionMs = reducedMotion ? 0 : motionTokenMs('--q-motion-piece', 160);

  const gameSession = useMemo(() => snapshot ? authoritativeRoomSession(snapshot) : null, [snapshot]);
  const pos = useMemo(() => roomPosition(gameSession?.fen), [gameSession?.fen]);
  const yourTurn = Boolean(seat && gameSession && canColorMove(gameSession, seat.color));
  const elapsed = snapshot ? Math.max(0, now - snapshotAt) : 0;
  const activeColor = gameSession ? clockOwner(gameSession) : null;
  const strategySeconds = gameSession?.state === 'COUNTDOWN'
    ? Math.max(0, Math.ceil((gameSession.countdownEndsAt ? gameSession.countdownEndsAt - (snapshot?.serverNow ?? now) - elapsed : gameSession.countdownMs - elapsed) / 1000))
    : 0;
  const whiteMs = gameSession ? Math.max(0, gameSession.clocks.whiteMs - (activeColor === 'white' ? elapsed : 0)) : 0;
  const blackMs = gameSession ? Math.max(0, gameSession.clocks.blackMs - (activeColor === 'black' ? elapsed : 0)) : 0;
  const youLeadColorBid = Boolean(snapshot?.colorAuction.leadingBidCents
    && snapshot.colorAuction.yourBidCents === snapshot.colorAuction.leadingBidCents
    && !snapshot.colorAuction.yourBidRefunded
    && snapshot.colorAuction.yourDesiredColor === snapshot.colorAuction.desiredColor);

  const send = useCallback((payload: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(payload));
  }, []);

  useEffect(() => subscribeClockVisible(setShowClock), []);

  useEffect(() => {
    loadTournamentCatalog().then(catalog => {
      setPaymentMode(catalog.paymentMode);
      setPaymentConfigured(catalog.paymentConfigured);
      setLivePositionBidsEnabled(Boolean(catalog.livePositionBidsEnabled));
      setLiveColorBidsEnabled(Boolean(catalog.liveColorBidsEnabled));
    }).catch(() => setPaymentConfigured(false));
  }, []);

  const syncBoard = useCallback(() => {
    if (!ground.current || !gameSession || !pos) return;
    ground.current.set({
      fen: gameSession.fen,
      orientation: seat?.color ?? 'white',
      turnColor: gameSession.sideToMove,
      check: gameSession.check,
      animation: { enabled: !reducedMotion, duration: pieceMotionMs },
      draggable: { enabled: yourTurn, autoDistance: true, showGhost: true },
      selectable: { enabled: yourTurn },
      movable: {
        free: false,
        color: yourTurn ? gameSession.sideToMove : undefined,
        dests: yourTurn ? chessgroundDests(pos, { chess960: true }) : new Map(),
        showDests: true,
        rookCastle: true,
      },
    });
  }, [gameSession, pieceMotionMs, pos, reducedMotion, seat?.color, yourTurn]);

  const handleMove = useCallback((orig: Key, dest: Key) => {
    if (!yourTurn || !pos) return requestAnimationFrame(syncBoard);
    const from = parseSquare(orig);
    const piece = from === undefined ? undefined : pos.board.get(from);
    if (piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) {
      setPromotion({ orig, dest });
      return requestAnimationFrame(syncBoard);
    }
    moveSequence.current += 1;
    send({ type: 'move', uci: `${orig}${dest}`, clientSentAt: Date.now(), clientMonotonicMs: performance.now(), clientSequence: moveSequence.current });
  }, [pos, send, syncBoard, yourTurn]);
  moveHandler.current = handleMove;

  useEffect(() => {
    if (!seat) return;
    rememberSeat(seat);
    setMessage('');
    const ws = connectRoom(seat, (event: ServerEvent) => {
      if (event.type === 'error') return setMessage(event.message);
      if (event.type !== 'snapshot') return;
      const receivedAt = Date.now();
      setSnapshot(event.room);
      setSnapshotAt(receivedAt);
      setNow(receivedAt);
      if (event.room.yourColor) setSeat(current => {
        if (!current || current.color === event.room.yourColor) return current;
        const updated: RoomSeat = { ...current, color: event.room.yourColor! };
        rememberSeat(updated);
        return updated;
      });
    }, status => setConnection(status === 'closed' ? 'closed' : status));
    socket.current = ws;
    return () => { ws.close(); if (socket.current === ws) socket.current = null; };
  }, [seat?.code, seat?.token]);

  useEffect(() => {
    if (connection !== 'connected' || !returnedBidSession || bidClaimSent.current === returnedBidSession) return;
    bidClaimSent.current = returnedBidSession;
    send({ type: 'claim_position_bid', sessionId: returnedBidSession });
    const url = new URL(location.href);
    ['checkout', 'kind', 'item', 'session_id'].forEach(key => url.searchParams.delete(key));
    history.replaceState({}, '', url);
    setMessage('Verifying your paid position bid with the room server…');
  }, [connection, returnedBidSession, send]);

  useEffect(() => {
    if (connection !== 'connected' || !returnedColorBidSession || colorBidClaimSent.current === returnedColorBidSession) return;
    colorBidClaimSent.current = returnedColorBidSession;
    send({ type: 'claim_color_bid', sessionId: returnedColorBidSession });
    const url = new URL(location.href);
    ['checkout', 'kind', 'item', 'session_id', 'color'].forEach(key => url.searchParams.delete(key));
    history.replaceState({}, '', url);
    setMessage(`Verifying your paid bid for ${returnedColor === 'white' ? 'White' : 'Black'}…`);
  }, [connection, returnedColor, returnedColorBidSession, send]);

  useEffect(() => {
    if (!snapshot || !returnedBidSession || !snapshot.auction.yourBidCents) return;
    if (!bidCelebrated.current) { bidCelebrated.current = true; celebratePurchase(); }
    setMessage(`Verified position bid: ${money(snapshot.auction.yourBidCents)}.`);
  }, [returnedBidSession, snapshot?.auction.yourBidCents]);

  useEffect(() => {
    if (!snapshot || !returnedColorBidSession || !snapshot.colorAuction.yourBidCents) return;
    if (snapshot.colorAuction.yourBidRefunded) {
      setMessage(`Your ${money(snapshot.colorAuction.yourBidCents)} color bid was outbid and the payment was refunded automatically.`);
      return;
    }
    if (!colorBidCelebrated.current) { colorBidCelebrated.current = true; celebratePurchase(); }
    setMessage(`Color bid verified: ${money(snapshot.colorAuction.yourBidCents)} for ${snapshot.colorAuction.yourDesiredColor === 'white' ? 'White' : 'Black'}.`);
  }, [returnedColorBidSession, snapshot?.colorAuction.yourBidCents, snapshot?.colorAuction.yourBidRefunded]);

  useEffect(() => {
    if (!snapshot || !gameSession) return;
    if (gameSession.movesSan.length > lastMoveSoundCount.current) {
      playChessSound((gameSession.movesSan.at(-1) ?? '').includes('x') ? 'capture' : 'move');
      lastMoveSoundCount.current = gameSession.movesSan.length;
    }
    if (snapshot.coin.result && snapshot.coin.result !== lastCoinResult.current) {
      playChessSound('coin');
      lastCoinResult.current = snapshot.coin.result;
    }
    if (gameSession.result && gameSession.result !== lastResult.current) {
      playChessSound('win');
      lastResult.current = gameSession.result;
    }
  }, [gameSession, snapshot]);

  useEffect(() => {
    if (!gameSession || !['COIN_TOSS', 'COLOR_SELECTION', 'COUNTDOWN', 'ACTIVE'].includes(gameSession.state)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [gameSession?.state]);

  useEffect(() => syncBoard(), [syncBoard]);
  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen: gameSession?.fen,
    orientation: seat?.color ?? 'white',
    turnColor: gameSession?.sideToMove ?? 'white',
    coordinates: true,
    coordinatesOnSquares: true,
    blockTouchScroll: true,
    disableContextMenu: true,
    autoCastle: true,
    movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
  }), [gameSession?.fen, gameSession?.sideToMove, seat?.color, snapshot?.code]);

  const setRoomUrl = (code: string) => {
    const url = new URL(location.href);
    url.searchParams.set('room', code.toUpperCase());
    history.replaceState({}, '', url);
  };
  const create = async () => {
    setBusy(true); setMessage('');
    try { const created = await createRoom(name.trim() || 'Guest', roomTimeControl, variant === 'tournament' ? tournamentPolicy.templateId : undefined); setRoomCode(created.code); rememberSeat(created); setSeat(created); setRoomUrl(created.code); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create room.'); }
    finally { setBusy(false); }
  };
  const join = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return setMessage('Enter a room code first.');
    setBusy(true); setMessage('');
    try { const joined = await joinRoom(code, name.trim() || 'Guest'); rememberSeat(joined); setSeat(joined); setRoomUrl(joined.code); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not join room.'); }
    finally { setBusy(false); }
  };
  const copyInvite = async () => {
    if (!seat) return;
    const value = inviteUrl(seat.code);
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch { setMessage(`Invite link: ${value}`); }
  };
  const choosePromotion = (piece: PromotionLetter) => {
    if (!promotion) return;
    moveSequence.current += 1;
    send({ type: 'move', uci: `${promotion.orig}${promotion.dest}${piece}`, clientSentAt: Date.now(), clientMonotonicMs: performance.now(), clientSequence: moveSequence.current });
    setPromotion(null);
  };
  const buyBid = async (cents: 200 | 500) => {
    if (!seat) return;
    setBidBusy(cents); setMessage('Opening secure checkout for the position bid…');
    try { location.assign(await createCheckout(`position-bid-${cents}`, 'position_bid', { roomCode: seat.code })); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start checkout.'); setBidBusy(0); }
  };
  const buyColorBid = async (cents: 200 | 500) => {
    if (!seat) return;
    setColorBidBusy(cents); setMessage(`Opening secure checkout to bid for ${desiredColor === 'white' ? 'White' : 'Black'}…`);
    try { location.assign(await createCheckout(`color-bid-${cents}`, 'color_bid', { roomCode: seat.code, desiredColor })); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start color-bid checkout.'); setColorBidBusy(0); }
  };

  const canLeave = !gameSession || canLeaveGameSession(gameSession);
  const canDraw = Boolean(gameSession && canOfferDraw(gameSession));
  const canResign = Boolean(gameSession && canResignGameSession(gameSession));
  const bidAllowed = Boolean(snapshot && gameSession && ['COLOR_SELECTION', 'COIN_TOSS', 'COUNTDOWN'].includes(gameSession.state));
  const colorBidAllowed = Boolean(snapshot && gameSession && ['COLOR_SELECTION', 'COIN_TOSS'].includes(gameSession.state) && !snapshot.coin.result);
  const bidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || livePositionBidsEnabled);
  const colorBidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || liveColorBidsEnabled);
  const opponentColor: 'white' | 'black' = seat?.color === 'white' ? 'black' : 'white';
  const playerFor = (color: 'white' | 'black') => snapshot?.players[color] ?? null;
  const clockFor = (color: 'white' | 'black') => formatClockMs(color === 'white' ? whiteMs : blackMs);
  const opponentOfferedDraw = Boolean(gameSession?.drawOffers[opponentColor]);
  const youOfferedDraw = Boolean(seat && gameSession?.drawOffers[seat.color]);

  if (!seat) return (
    <section className="online-lobby-panel" aria-label="Online multiplayer lobby">
      <div className="online-lobby-heading"><div><span className="eyebrow">ONLINE MULTIPLAYER</span><h3>{variant === 'tournament' ? 'Enter the QQURZ tournament room' : 'Play across different internet connections'}</h3><p>Create or join a six-character room. QQURZ keeps the color toss, shared Chess960 position and clock state on the server.</p></div><span className={`server-readiness ${multiplayerConfigured ? 'configured' : ''}`}>{multiplayerConfigured ? 'Server configured' : 'Backend connection required'}</span></div>
      <label className="online-field"><span>Your display name</span><input value={name} maxLength={28} onChange={event => setName(event.target.value)} placeholder="Player name" /></label>
      <TimeControlPicker value={roomTimeControl} onChange={setRoomTimeControl} allowedPresetIds={variant === 'tournament' ? tournamentPolicy.allowed : undefined} allowCustom={variant !== 'tournament'} label={variant === 'tournament' ? 'Tournament clock' : 'Room clock'} />
      <div className="online-actions-grid"><button className="online-primary" onClick={create} disabled={!multiplayerConfigured || busy}>{busy ? 'Working…' : 'Create private room'}</button><div className="join-room-box"><input value={roomCode} onChange={event => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="ROOM CODE"/><button onClick={join} disabled={!multiplayerConfigured || busy}>Join</button></div></div>
      {message && <p className="online-error">{message}</p>}<button className="online-back" onClick={onClose}>Back to match choices</button>
    </section>
  );

  return (
    <section className="online-room-shell" data-game-state={gameSession?.state ?? 'LOBBY'}>
      <header className="online-room-header match-room-header">
        <div><strong>{variant === 'tournament' ? 'Tournament' : 'Live room'} · {seat.code}</strong> <small>{connection === 'connected' ? '● Connected' : `● ${connection}`}</small></div>
        <div className="online-header-actions">{canLeave ? <button onClick={onClose}>Leave</button> : <span className="game-locked-pill">Game in progress</span>}</div>
      </header>
      {snapshot ? <div className="online-game-grid match-game-grid">
        <div className="online-board-column match-board-column">
          <div className="match-game-meta"><b>Chess960 · #{gameSession?.positionId ?? snapshot.positionId}</b><span>{variant === 'tournament' ? 'Tournament game' : 'Live game'} · {gameSession ? timeControlLabel(gameSession.clocks.baseMs, gameSession.clocks.incrementMs) : roomTimeControl.label}</span></div>

          <MatchPlayerBar
            color={opponentColor}
            name={playerFor(opponentColor)?.name ?? 'Waiting for opponent'}
            rating="Unrated"
            connection={playerFor(opponentColor)?.connected ? 'Connected' : 'Reconnecting'}
            connected={Boolean(playerFor(opponentColor)?.connected)}
            time={clockFor(opponentColor)}
            fen={gameSession?.fen ?? snapshot.fen}
            active={activeColor === opponentColor}
          />

          <div className={`board-frame online-board-frame match-board-frame ${variant === 'tournament' ? 'tournament-green-board' : ''}`}>
            <ChessBoardSurface
              apiRef={ground}
              instanceKey={snapshot.code}
              config={boardConfig}
              ariaLabel="Online Chess960 board"
              onReady={() => syncBoard()}
            />
            {gameSession?.state === 'LOBBY' && <div className="board-overlay online-waiting-overlay"><div><span>WAITING FOR OPPONENT</span><strong className="room-code-display">{snapshot.code}</strong><small>Share this code or invite link with player two.</small></div></div>}
            {(gameSession?.state === 'COLOR_SELECTION' || gameSession?.state === 'COIN_TOSS') && <div className="board-overlay coin-overlay"><div className="coin-stage real-quarter-stage"><span>COLOR TOSS · REAL U.S. QUARTER</span><Quarter3D result={snapshot.coin.result} flippedAt={snapshot.coin.flippedAt}/>{snapshot.colorAuction.leaderName ? <><strong>Paid color auction is active.</strong><p><b>{snapshot.colorAuction.leaderName}</b> leads at {money(snapshot.colorAuction.leadingBidCents)} for {snapshot.colorAuction.desiredColor === 'white' ? 'White' : 'Black'}. The losing paid bid is refunded automatically when it is outbid.</p>{youLeadColorBid ? <button className="lock-color-bid" onClick={() => send({ type: 'settle_color_bid' })}>Lock {snapshot.colorAuction.desiredColor === 'white' ? 'White' : 'Black'} and continue</button> : <small>Outbid the leader below, or wait for them to lock the side.</small>}</> : !snapshot.coin.result ? <><strong>Call the quarter.</strong><p>The other player automatically gets the opposite face. The toss winner receives White.</p><div className="coin-call-actions"><button onClick={() => send({ type: 'call_coin', face: 'heads' })}>Heads</button><button onClick={() => send({ type: 'call_coin', face: 'tails' })}>Tails</button></div></> : <><strong>{snapshot.coin.result.toUpperCase()} · {snapshot.coin.winner} gets White</strong><p>You called {snapshot.coin.yourFace ?? '—'} · your assigned color is {snapshot.yourColor ?? seat.color}.</p></>}</div></div>}
            {gameSession?.state === 'COUNTDOWN' && <div className="board-overlay strategy-overlay online-strategy-overlay"><div><span>STRATEGY PHASE</span><strong>{formatClockMs(strategySeconds * 1000)}</strong><small>Green dots show legal destinations. Tactical danger warnings stay off, so players can still blunder.</small><button className="overlay-start-button" onClick={() => { playChessSound('start'); send({ type: 'start_now' }); }}>Start Now</button></div></div>}
            {gameSession && isTerminalGameState(gameSession.state) && gameSession.result && <div className="board-overlay ended online-ended-overlay"><div><span>GAME OVER</span><strong className="end-title">{gameSession.result}</strong></div></div>}
          </div>

          <MatchPlayerBar
            color={seat.color}
            name={playerFor(seat.color)?.name ?? name}
            rating="Unrated"
            connection={connection === 'connected' ? 'Connected' : connection}
            connected={connection === 'connected'}
            time={clockFor(seat.color)}
            fen={gameSession?.fen ?? snapshot.fen}
            active={activeColor === seat.color}
            self
          />

          <PhysicalChessClock
            whiteSeconds={whiteMs / 1000}
            blackSeconds={blackMs / 1000}
            activeColor={activeColor}
            pendingSlap={gameSession?.pendingClockPress ?? null}
            disabled={gameSession?.pendingClockPress !== seat.color}
            onSlap={() => send({ type: 'clock_slap' })}
            compact
            visible={showClock}
            onVisibleChange={setClockVisible}
            className="online-physical-clock match-clock-panel"
          />

          {colorBidAllowed && <section className="position-auction-card color-auction-card"><div><span className="eyebrow">BID FOR YOUR COLOR</span><h3>Choose White or Black. Highest verified bid gets that side.</h3><p>If another player outbids your active bid, QQURZ submits a Stripe refund to the original payment method automatically. If nobody bids, use the quarter toss above.</p></div><div className="color-choice-pills" role="radiogroup" aria-label="Desired chess color"><button className={desiredColor === 'white' ? 'selected' : ''} onClick={() => setDesiredColor('white')}>White</button><button className={desiredColor === 'black' ? 'selected' : ''} onClick={() => setDesiredColor('black')}>Black</button></div><div className="auction-status"><span>Leader</span><b>{snapshot.colorAuction.leaderName ?? 'No bid yet'}</b><span>Winning side</span><b>{snapshot.colorAuction.desiredColor ? snapshot.colorAuction.desiredColor[0].toUpperCase() + snapshot.colorAuction.desiredColor.slice(1) : '—'}</b><span>Top bid</span><b>{snapshot.colorAuction.leadingBidCents ? money(snapshot.colorAuction.leadingBidCents) : '—'}</b><span>Your last bid</span><b>{snapshot.colorAuction.yourBidCents ? `${money(snapshot.colorAuction.yourBidCents)}${snapshot.colorAuction.yourBidRefunded ? ' · refunded' : ''}` : '—'}</b></div><div className="auction-actions"><button onClick={() => buyColorBid(200)} disabled={!colorBidPaymentsAvailable || Boolean(colorBidBusy)}>{colorBidBusy === 200 ? 'Opening…' : `Bid $2 for ${desiredColor === 'white' ? 'White' : 'Black'}`}</button><button onClick={() => buyColorBid(500)} disabled={!colorBidPaymentsAvailable || Boolean(colorBidBusy)}>{colorBidBusy === 500 ? 'Opening…' : `Bid $5 for ${desiredColor === 'white' ? 'White' : 'Black'}`}</button>{youLeadColorBid && <button className="settle-color-auction" onClick={() => send({ type: 'settle_color_bid' })}>Lock winning color</button>}</div><small>{paymentMode === 'test' ? 'Stripe test mode: refund flow is exercised without real money.' : liveColorBidsEnabled ? 'Live color bidding and automatic outbid refunds are enabled.' : 'Live color bidding is disabled by server policy.'}</small></section>}

          {bidAllowed && <section className="position-auction-card"><div><span className="eyebrow">POSITION REROLL BID</span><h3>Highest verified bid controls the next shared shuffle.</h3><p>QQURZ uses all 960 legal Chess960 starts. A new highest verified bid rerolls the same board for both players.</p></div><div className="auction-status"><span>Leader</span><b>{snapshot.auction.leaderName ?? 'No bid yet'}</b><span>Top bid</span><b>{snapshot.auction.leadingBidCents ? money(snapshot.auction.leadingBidCents) : '—'}</b><span>Your bid</span><b>{snapshot.auction.yourBidCents ? money(snapshot.auction.yourBidCents) : '—'}</b></div><div className="auction-actions"><button onClick={() => buyBid(200)} disabled={!bidPaymentsAvailable || Boolean(bidBusy)}>{bidBusy === 200 ? 'Opening…' : 'Bid $2 & reroll'}</button><button onClick={() => buyBid(500)} disabled={!bidPaymentsAvailable || Boolean(bidBusy)}>{bidBusy === 500 ? 'Opening…' : 'Bid $5 & reroll'}</button></div><small>{paymentMode === 'test' ? 'Stripe test mode: no real money moves.' : livePositionBidsEnabled ? 'Live position bidding enabled by server policy.' : 'Live position bidding is disabled.'}</small></section>}

          <div className="match-controls" aria-label="Game controls">
            <div className={`match-turn-note ${yourTurn ? 'active' : ''}`}>{gameSession && isTerminalGameState(gameSession.state) ? gameSession.result : gameSession?.pendingClockPress === seat.color ? 'Move made — press your clock' : gameSession?.pendingClockPress ? 'Opponent is pressing their clock' : gameSession?.state === 'ACTIVE' ? yourTurn ? 'Your move' : 'Opponent move' : gameSession?.state === 'RECONNECTING' ? 'Reconnecting — clocks paused' : gameSession?.state === 'PAUSED' ? 'Game paused' : gameSession?.state === 'COUNTDOWN' ? 'Strategy phase' : gameSession?.state === 'COLOR_SELECTION' || gameSession?.state === 'COIN_TOSS' ? 'Color selection' : gameSession?.state === 'READY' ? 'Players ready' : 'Waiting for opponent'}</div>
            {gameSession?.pendingClockPress === seat.color && !showClock && <button className={`clock-slap-inline ${seat.color}`} onClick={() => send({ type: 'clock_slap' })}>Slap clock</button>}
            <button onClick={() => send({ type: opponentOfferedDraw ? 'accept_draw' : 'offer_draw' })} disabled={!canDraw || youOfferedDraw}>{opponentOfferedDraw ? 'Accept draw' : youOfferedDraw ? 'Draw offered' : 'Draw'}</button>
            {opponentOfferedDraw && canDraw && <button onClick={() => send({ type: 'decline_draw' })}>Decline</button>}
            <button className="match-resign resign-button" onClick={() => send({ type: 'resign' })} disabled={!canResign}>Resign</button>
            <button aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}>Options</button>
          </div>

          {optionsOpen && <section className="match-options-panel" aria-label="Room options">
            <div><span>Room</span><b>{snapshot.code}</b></div>
            <div><span>Position</span><b>Chess960 #{gameSession?.positionId ?? snapshot.positionId}</b></div>
            <div><span>Moves</span><b>{gameSession?.moveNumber ?? 0}</b></div>
            <div><span>State</span><b>{gameSession?.state ?? 'LOBBY'}</b></div>
            <div><span>Connection</span><b>{gameSession?.connection.status ?? 'DISCONNECTED'}</b></div>
            <div><span>Time control</span><b>{gameSession ? timeControlLabel(gameSession.clocks.baseMs, gameSession.clocks.incrementMs) : roomTimeControl.label}</b></div>
            <div><span>Increment</span><b>{(gameSession?.clocks.incrementMs ?? 0) / 1000}s</b></div>
            <div className="match-options-actions"><button onClick={copyInvite}>{copied ? 'Invite copied ✓' : 'Copy invite link'}</button>{canLeave && <button onClick={onClose}>Leave room</button>}</div>
            <div className="match-move-list"><span className="qqurz-kicker">MOVES</span>{gameSession?.movesSan.length ? <ol>{gameSession.movesSan.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}</div>
          </section>}

          {message && <p className="online-error">{message}</p>}
        </div>
      </div> : <div className="online-connecting-state">Connecting to room {seat.code}…</div>}

      {promotion && <div className="online-promotion" role="dialog" aria-label="Choose online promotion piece"><div><b>Promote pawn</b><button onClick={() => choosePromotion('q')}><ChessPieceAsset role="queen" color={gameSession?.sideToMove ?? seat.color} size="lg" /><span>Queen</span></button><button onClick={() => choosePromotion('r')}><ChessPieceAsset role="rook" color={gameSession?.sideToMove ?? seat.color} size="lg" /><span>Rook</span></button><button onClick={() => choosePromotion('b')}><ChessPieceAsset role="bishop" color={gameSession?.sideToMove ?? seat.color} size="lg" /><span>Bishop</span></button><button onClick={() => choosePromotion('n')}><ChessPieceAsset role="knight" color={gameSession?.sideToMove ?? seat.color} size="lg" /><span>Knight</span></button></div></div>}
    </section>
  );
}
