from pathlib import Path


def replace_required(source: str, search: str, replacement: str, label: str) -> str:
    if search not in source:
        raise RuntimeError(f"Missing migration target: {label}")
    return source.replace(search, replacement, 1)


def replace_range(source: str, start_needle: str, end_needle: str, replacement: str, label: str) -> str:
    start = source.find(start_needle)
    if start < 0:
        raise RuntimeError(f"Missing migration start: {label}")
    end = source.find(end_needle, start)
    if end < 0:
        raise RuntimeError(f"Missing migration end: {label}")
    return source[:start] + replacement + source[end:]


# Local / AI game.
path = Path('src/LocalGame.tsx')
source = path.read_text()
source = replace_required(source, "import CapturedPieces from './ui/CapturedPieces';\n", "import MatchPlayerBar from './ui/MatchPlayerBar';\n", 'LocalGame player rail import')
source = replace_required(source, "  const [pendingSlap, setPendingSlap] = useState<Color | null>(null);\n", "  const [pendingSlap, setPendingSlap] = useState<Color | null>(null);\n  const [optionsOpen, setOptionsOpen] = useState(false);\n", 'LocalGame options state')
source = replace_required(source, """  const activeColor = phase === 'playing' ? (pendingSlap ?? turn) : null;
  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({""", """  const activeColor = phase === 'playing' ? (pendingSlap ?? turn) : null;
  const connectionFor = (color: Color) => {
    if (mode !== 'ai' || aiColor !== color) return 'Local';
    if (engineStatus === 'thinking') return 'Thinking';
    if (engineStatus === 'loading') return 'Loading';
    if (engineStatus === 'error') return 'Engine error';
    return 'Ready';
  };
  const ratingFor = (color: Color) => mode === 'ai' && aiColor === color ? DIFFICULTIES[difficulty].label : 'Unrated';
  const finishLocalGame = (text: string) => {
    if (phase !== 'playing') return;
    setResult(text);
    setPhase('ended');
    setPendingSlap(null);
    engine.current?.cancelSearch();
    playChessSound('win');
  };
  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({""", 'LocalGame match helpers')

local_render = r'''  return (
    <section className="local-fast-shell local-chess-layout">
      <div className="match-board-stack">
        <div className="match-game-meta">
          <b>Chess960 · #{positionId}</b>
          <span>{mode === 'ai' ? `You vs ${DIFFICULTIES[difficulty].label} Stockfish` : 'Same-device game'}</span>
        </div>

        {mode === 'ai' && <div className={`local-engine-state match-engine-state ${engineStatus}`}>{engineStatus === 'loading' ? 'Loading Stockfish…' : engineStatus === 'thinking' ? 'Stockfish thinking…' : engineStatus === 'ready' ? 'Stockfish ready' : engineError || 'AI preparing'}</div>}

        <MatchPlayerBar
          color={topColor}
          name={playerName(topColor)}
          rating={ratingFor(topColor)}
          connection={connectionFor(topColor)}
          connected={mode !== 'ai' || aiColor !== topColor || engineStatus !== 'error'}
          time={clockFor(topColor)}
          fen={fen}
          active={activeColor === topColor}
        />

        <div className="local-board-frame match-board-frame">
          <ChessBoardSurface
            apiRef={ground}
            instanceKey={positionId ?? 'local'}
            config={boardConfig}
            ariaLabel="Interactive Chess960 board"
            onReady={() => syncBoard()}
          />
          {phase === 'strategy' && (
            <div className="local-board-overlay">
              <span>STRATEGY</span>
              <strong>{formatClock(strategyTime)}</strong>
              <p>Green dots show legal destinations. Take your time, then start when you are ready.</p>
              <div>
                <button onPointerDown={() => setFastForward(true)} onPointerUp={() => setFastForward(false)} onPointerCancel={() => setFastForward(false)}>Hold ×4</button>
                <button className="primary-black" onClick={startNow}>Start game</button>
              </div>
            </div>
          )}
          {phase === 'ended' && result && (
            <div className="local-board-overlay ended"><span>GAME OVER</span><strong className="end-title">{result}</strong><button className="primary-black" onClick={createPosition}>New position</button></div>
          )}
        </div>

        <MatchPlayerBar
          color={bottomColor}
          name={playerName(bottomColor)}
          rating={ratingFor(bottomColor)}
          connection={connectionFor(bottomColor)}
          connected={mode !== 'ai' || aiColor !== bottomColor || engineStatus !== 'error'}
          time={clockFor(bottomColor)}
          fen={fen}
          active={activeColor === bottomColor}
          self
        />

        <ChessClock2D
          whiteSeconds={whiteClock}
          blackSeconds={blackClock}
          activeColor={activeColor}
          pendingSlap={pendingSlap}
          disabled={!pendingSlap || pendingSlap === aiColor}
          onSlap={slapClock}
        />

        <div className="match-controls" aria-label="Game controls">
          <div className={`match-turn-note ${activeColor === bottomColor ? 'active' : ''}`}>
            {phase === 'strategy' ? 'Strategy phase' : phase === 'ended' ? result : pendingSlap === bottomColor ? 'Move made — press your clock' : activeColor === bottomColor ? 'Your move' : 'Opponent move'}
          </div>
          <button onClick={() => finishLocalGame('Draw by agreement')} disabled={phase !== 'playing'}>Draw</button>
          <button className="match-resign" onClick={() => finishLocalGame(`${opposite(bottomColor) === 'white' ? 'White' : 'Black'} wins by resignation`)} disabled={phase !== 'playing'}>Resign</button>
          <button aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}>Options</button>
        </div>

        {optionsOpen && (
          <section className="match-options-panel" aria-label="Match options">
            <div><span>Position</span><b>Chess960 #{positionId}</b></div>
            <div><span>Back rank</span><b>{backRank}</b></div>
            <div><span>Moves</span><b>{moves.length}</b></div>
            <div className="match-options-actions">
              <button onClick={() => setOrientation(value => opposite(value))}>Flip board</button>
              <button onClick={createPosition} disabled={phase === 'playing'}>{phase === 'playing' ? 'Position locked' : 'New position'}</button>
            </div>
            <div className="match-move-list">
              <span className="qqurz-kicker">MOVES</span>
              {moves.length ? <ol>{moves.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}
            </div>
          </section>
        )}
      </div>

'''
source = replace_range(source, '  return (\n    <section className="local-fast-shell local-chess-layout">', '      {promotion && (', local_render, 'LocalGame board-first render')
path.write_text(source)

# Online / tournament game.
path = Path('src/multiplayer/OnlineArena.tsx')
source = path.read_text()
source = replace_required(source, "import CapturedPieces from '../ui/CapturedPieces';\n", "import MatchPlayerBar from '../ui/MatchPlayerBar';\n", 'OnlineArena player rail import')
source = replace_required(source, "  const [showClock, setShowClock] = useState(clockVisible);\n", "  const [showClock, setShowClock] = useState(clockVisible);\n  const [optionsOpen, setOptionsOpen] = useState(false);\n", 'OnlineArena options state')
source = replace_required(source, """  const colorBidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || liveColorBidsEnabled);

  if (!seat) return (""", """  const colorBidPaymentsAvailable = paymentConfigured && (paymentMode === 'test' || liveColorBidsEnabled);
  const opponentColor: 'white' | 'black' = seat?.color === 'white' ? 'black' : 'white';
  const playerFor = (color: 'white' | 'black') => snapshot?.players[color] ?? null;
  const clockFor = (color: 'white' | 'black') => formatClockMs(color === 'white' ? whiteMs : blackMs);

  if (!seat) return (""", 'OnlineArena player helpers')

online_render = r'''  return (
    <section className="online-room-shell">
      <header className="online-room-header match-room-header">
        <div><strong>{variant === 'tournament' ? 'Tournament' : 'Live room'} · {seat.code}</strong> <small>{connection === 'connected' ? '● Connected' : `● ${connection}`}</small></div>
        <div className="online-header-actions">{canLeave ? <button onClick={onClose}>Leave</button> : <span className="game-locked-pill">Game in progress</span>}</div>
      </header>
      {snapshot ? <div className="online-game-grid match-game-grid">
        <div className="online-board-column match-board-column">
          <div className="match-game-meta"><b>Chess960 · #{snapshot.positionId}</b><span>{variant === 'tournament' ? 'Tournament game' : 'Live game'}</span></div>

          <MatchPlayerBar
            color={opponentColor}
            name={playerFor(opponentColor)?.name ?? 'Waiting for opponent'}
            rating="Unrated"
            connection={playerFor(opponentColor)?.connected ? 'Connected' : 'Reconnecting'}
            connected={Boolean(playerFor(opponentColor)?.connected)}
            time={clockFor(opponentColor)}
            fen={snapshot.fen}
            active={snapshot.activeClock === opponentColor && snapshot.status === 'playing'}
          />

          <div className={`board-frame online-board-frame match-board-frame ${variant === 'tournament' ? 'tournament-green-board' : ''}`}>
            <ChessBoardSurface
              apiRef={ground}
              instanceKey={snapshot.code}
              config={boardConfig}
              ariaLabel="Online Chess960 board"
              onReady={() => syncBoard()}
            />
            {snapshot.status === 'waiting' && <div className="board-overlay online-waiting-overlay"><div><span>WAITING FOR OPPONENT</span><strong className="room-code-display">{snapshot.code}</strong><small>Share this code or invite link with player two.</small></div></div>}
            {snapshot.status === 'coin' && <div className="board-overlay coin-overlay"><div className="coin-stage real-quarter-stage"><span>COLOR TOSS · REAL U.S. QUARTER</span><Quarter3D result={snapshot.coin.result} flippedAt={snapshot.coin.flippedAt}/>{snapshot.colorAuction.leaderName ? <><strong>Paid color auction is active.</strong><p><b>{snapshot.colorAuction.leaderName}</b> leads at {money(snapshot.colorAuction.leadingBidCents)} for {snapshot.colorAuction.desiredColor === 'white' ? 'White' : 'Black'}. The losing paid bid is refunded automatically when it is outbid.</p>{youLeadColorBid ? <button className="lock-color-bid" onClick={() => send({ type: 'settle_color_bid' })}>Lock {snapshot.colorAuction.desiredColor === 'white' ? 'White' : 'Black'} and continue</button> : <small>Outbid the leader below, or wait for them to lock the side.</small>}</> : !snapshot.coin.result ? <><strong>Call the quarter.</strong><p>The other player automatically gets the opposite face. The toss winner receives White.</p><div className="coin-call-actions"><button onClick={() => send({ type: 'call_coin', face: 'heads' })}>Heads</button><button onClick={() => send({ type: 'call_coin', face: 'tails' })}>Tails</button></div></> : <><strong>{snapshot.coin.result.toUpperCase()} · {snapshot.coin.winner} gets White</strong><p>You called {snapshot.coin.yourFace ?? '—'} · your assigned color is {snapshot.yourColor ?? seat.color}.</p></>}</div></div>}
            {snapshot.status === 'strategy' && <div className="board-overlay strategy-overlay online-strategy-overlay"><div><span>STRATEGY PHASE</span><strong>{formatClockMs(strategySeconds * 1000)}</strong><small>Green dots show legal destinations. Tactical danger warnings stay off, so players can still blunder.</small><button className="overlay-start-button" onClick={() => { playChessSound('start'); send({ type: 'start_now' }); }}>Start Now</button></div></div>}
            {snapshot.status === 'ended' && snapshot.result && <div className="board-overlay ended online-ended-overlay"><div><span>GAME OVER</span><strong className="end-title">{snapshot.result}</strong></div></div>}
          </div>

          <MatchPlayerBar
            color={seat.color}
            name={playerFor(seat.color)?.name ?? name}
            rating="Unrated"
            connection={connection === 'connected' ? 'Connected' : connection}
            connected={connection === 'connected'}
            time={clockFor(seat.color)}
            fen={snapshot.fen}
            active={snapshot.activeClock === seat.color && snapshot.status === 'playing'}
            self
          />

          <section className={`qqurz-physical-clock-panel online-physical-clock match-clock-panel ${showClock ? '' : 'clock-hidden'}`} aria-label="Online 3D tournament clock">
            <div className="qqurz-clock-panel-head">
              <div><b>TOURNAMENT CLOCK</b><span>{snapshot.awaitingClockPress ? `${snapshot.awaitingClockPress.toUpperCase()} · press the rocker` : snapshot.status === 'playing' && snapshot.activeClock ? `${snapshot.activeClock.toUpperCase()} clock running` : 'Ready'}</span></div>
              <button type="button" className="clock-visibility-toggle" onClick={() => setClockVisible(!showClock)}>{showClock ? 'Hide clock' : 'Show clock'}</button>
            </div>
            {showClock ? <ChessClock3DView whiteSeconds={whiteMs / 1000} blackSeconds={blackMs / 1000} activeColor={snapshot.status === 'playing' ? snapshot.activeClock : null} pendingSlap={snapshot.awaitingClockPress} disabled={snapshot.awaitingClockPress !== seat.color} onSlap={() => send({ type: 'clock_slap' })} compact /> : null}
          </section>

          {colorBidAllowed && <section className="position-auction-card color-auction-card"><div><span className="eyebrow">BID FOR YOUR COLOR</span><h3>Choose White or Black. Highest verified bid gets that side.</h3><p>If another player outbids your active bid, QQURZ submits a Stripe refund to the original payment method automatically. If nobody bids, use the quarter toss above.</p></div><div className="color-choice-pills" role="radiogroup" aria-label="Desired chess color"><button className={desiredColor === 'white' ? 'selected' : ''} onClick={() => setDesiredColor('white')}>White</button><button className={desiredColor === 'black' ? 'selected' : ''} onClick={() => setDesiredColor('black')}>Black</button></div><div className="auction-status"><span>Leader</span><b>{snapshot.colorAuction.leaderName ?? 'No bid yet'}</b><span>Winning side</span><b>{snapshot.colorAuction.desiredColor ? snapshot.colorAuction.desiredColor[0].toUpperCase() + snapshot.colorAuction.desiredColor.slice(1) : '—'}</b><span>Top bid</span><b>{snapshot.colorAuction.leadingBidCents ? money(snapshot.colorAuction.leadingBidCents) : '—'}</b><span>Your last bid</span><b>{snapshot.colorAuction.yourBidCents ? `${money(snapshot.colorAuction.yourBidCents)}${snapshot.colorAuction.yourBidRefunded ? ' · refunded' : ''}` : '—'}</b></div><div className="auction-actions"><button onClick={() => buyColorBid(200)} disabled={!colorBidPaymentsAvailable || Boolean(colorBidBusy)}>{colorBidBusy === 200 ? 'Opening…' : `Bid $2 for ${desiredColor === 'white' ? 'White' : 'Black'}`}</button><button onClick={() => buyColorBid(500)} disabled={!colorBidPaymentsAvailable || Boolean(colorBidBusy)}>{colorBidBusy === 500 ? 'Opening…' : `Bid $5 for ${desiredColor === 'white' ? 'White' : 'Black'}`}</button>{youLeadColorBid && <button className="settle-color-auction" onClick={() => send({ type: 'settle_color_bid' })}>Lock winning color</button>}</div><small>{paymentMode === 'test' ? 'Stripe test mode: refund flow is exercised without real money.' : liveColorBidsEnabled ? 'Live color bidding and automatic outbid refunds are enabled.' : 'Live color bidding is disabled by server policy.'}</small></section>}

          {bidAllowed && <section className="position-auction-card"><div><span className="eyebrow">POSITION REROLL BID</span><h3>Highest verified bid controls the next shared shuffle.</h3><p>QQURZ uses all 960 legal Chess960 starts. A new highest verified bid rerolls the same board for both players.</p></div><div className="auction-status"><span>Leader</span><b>{snapshot.auction.leaderName ?? 'No bid yet'}</b><span>Top bid</span><b>{snapshot.auction.leadingBidCents ? money(snapshot.auction.leadingBidCents) : '—'}</b><span>Your bid</span><b>{snapshot.auction.yourBidCents ? money(snapshot.auction.yourBidCents) : '—'}</b></div><div className="auction-actions"><button onClick={() => buyBid(200)} disabled={!bidPaymentsAvailable || Boolean(bidBusy)}>{bidBusy === 200 ? 'Opening…' : 'Bid $2 & reroll'}</button><button onClick={() => buyBid(500)} disabled={!bidPaymentsAvailable || Boolean(bidBusy)}>{bidBusy === 500 ? 'Opening…' : 'Bid $5 & reroll'}</button></div><small>{paymentMode === 'test' ? 'Stripe test mode: no real money moves.' : livePositionBidsEnabled ? 'Live position bidding enabled by server policy.' : 'Live position bidding is disabled.'}</small></section>}

          <div className="match-controls" aria-label="Game controls">
            <div className={`match-turn-note ${yourTurn ? 'active' : ''}`}>{snapshot.status === 'ended' ? snapshot.result : snapshot.awaitingClockPress === seat.color ? 'Move made — press your clock' : snapshot.awaitingClockPress ? 'Opponent is pressing their clock' : snapshot.status === 'playing' ? yourTurn ? 'Your move' : 'Opponent move' : snapshot.status === 'strategy' ? 'Strategy phase' : snapshot.status === 'coin' ? 'Color selection' : 'Waiting for opponent'}</div>
            {snapshot.awaitingClockPress === seat.color && !showClock && <button className={`clock-slap-inline ${seat.color}`} onClick={() => send({ type: 'clock_slap' })}>Slap clock</button>}
            <button onClick={() => setMessage('Draw offers are not available in live rooms yet.')} disabled={snapshot.status !== 'playing'}>Draw</button>
            <button className="match-resign resign-button" onClick={() => send({ type: 'resign' })} disabled={snapshot.status !== 'playing'}>Resign</button>
            <button aria-expanded={optionsOpen} onClick={() => setOptionsOpen(value => !value)}>Options</button>
          </div>

          {optionsOpen && <section className="match-options-panel" aria-label="Room options">
            <div><span>Room</span><b>{snapshot.code}</b></div>
            <div><span>Position</span><b>Chess960 #{snapshot.positionId}</b></div>
            <div><span>Moves</span><b>{snapshot.moves.length}</b></div>
            <div><span>Connection</span><b>{connection}</b></div>
            <div className="match-options-actions"><button onClick={copyInvite}>{copied ? 'Invite copied ✓' : 'Copy invite link'}</button>{canLeave && <button onClick={onClose}>Leave room</button>}</div>
            <div className="match-move-list"><span className="qqurz-kicker">MOVES</span>{snapshot.moves.length ? <ol>{snapshot.moves.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}</div>
          </section>}

          {message && <p className="online-error">{message}</p>}
        </div>
      </div> : <div className="online-connecting-state">Connecting to room {seat.code}…</div>}

'''
source = replace_range(source, '  return (\n    <section className="online-room-shell">', '      {promotion &&', online_render, 'OnlineArena board-first render')
path.write_text(source)

print('Applied board-first 2D match hierarchy.')
