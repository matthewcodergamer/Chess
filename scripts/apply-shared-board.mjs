import fs from 'node:fs';

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing migration target: ${label}`);
  return source.replace(search, replacement);
}

// Local gameplay: mount the shared Chessground surface and cburnett promotion assets.
{
  const path = 'src/LocalGame.tsx';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceRequired(source,
    "import { Chessground } from '@lichess-org/chessground';\nimport type { Api as ChessgroundApi } from '@lichess-org/chessground/api';\n",
    '',
    'LocalGame direct Chessground imports');
  source = replaceRequired(source,
    "import CapturedPieces from './ui/CapturedPieces';\n",
    "import CapturedPieces from './ui/CapturedPieces';\nimport ChessBoardSurface, { type QQurzChessgroundApi, type QQurzChessgroundConfig } from './ui/ChessBoardSurface';\nimport ChessPieceAsset from './ui/ChessPieceAsset';\n",
    'LocalGame shared UI imports');
  source = replaceRequired(source,
    "  const boardNode = useRef<HTMLDivElement | null>(null);\n  const ground = useRef<ChessgroundApi | null>(null);\n",
    "  const ground = useRef<QQurzChessgroundApi | null>(null);\n",
    'LocalGame board refs');
  source = replaceRequired(source,
`  useEffect(() => {
    if (positionId === null || !boardNode.current) return;
    ground.current?.destroy();
    ground.current = Chessground(boardNode.current, {
      orientation,
      coordinates: true,
      coordinatesOnSquares: true,
      autoCastle: true,
      blockTouchScroll: true,
      disableContextMenu: true,
      movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
    });
    syncBoard();
    const resize = new ResizeObserver(() => ground.current?.redrawAll());
    resize.observe(boardNode.current);
    return () => { resize.disconnect(); ground.current?.destroy(); ground.current = null; };
  }, [positionId]);

`, '', 'LocalGame direct Chessground mount');
  source = replaceRequired(source,
    "  const activeColor = phase === 'playing' ? (pendingSlap ?? turn) : null;\n\n  if (phase === 'setup') {",
`  const activeColor = phase === 'playing' ? (pendingSlap ?? turn) : null;
  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen,
    orientation,
    coordinates: true,
    coordinatesOnSquares: true,
    autoCastle: true,
    blockTouchScroll: true,
    disableContextMenu: true,
    movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
  }), [fen, orientation]);

  if (phase === 'setup') {`,
    'LocalGame board config');
  source = replaceRequired(source,
    '          <div ref={boardNode} className="cg-wrap board-mount" aria-label="Interactive Chess960 board" />',
`          <ChessBoardSurface
            apiRef={ground}
            instanceKey={positionId ?? 'local'}
            config={boardConfig}
            ariaLabel="Interactive Chess960 board"
            onReady={() => syncBoard()}
          />`,
    'LocalGame board element');
  source = replaceRequired(source,
`            <div className="promotion-grid">
              <button onClick={() => promote('queen')}>♕ Queen</button>
              <button onClick={() => promote('rook')}>♖ Rook</button>
              <button onClick={() => promote('bishop')}>♗ Bishop</button>
              <button onClick={() => promote('knight')}>♘ Knight</button>
            </div>`,
`            <div className="promotion-grid">
              <button onClick={() => promote('queen')}><ChessPieceAsset role="queen" color={turn} size="lg" /><span>Queen</span></button>
              <button onClick={() => promote('rook')}><ChessPieceAsset role="rook" color={turn} size="lg" /><span>Rook</span></button>
              <button onClick={() => promote('bishop')}><ChessPieceAsset role="bishop" color={turn} size="lg" /><span>Bishop</span></button>
              <button onClick={() => promote('knight')}><ChessPieceAsset role="knight" color={turn} size="lg" /><span>Knight</span></button>
            </div>`,
    'LocalGame promotion Unicode pieces');
  fs.writeFileSync(path, source);
}

// Online/tournament gameplay: same shared surface, same SVG promotion assets.
{
  const path = 'src/multiplayer/OnlineArena.tsx';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceRequired(source,
    "import { Chessground } from '@lichess-org/chessground';\nimport type { Api as ChessgroundApi } from '@lichess-org/chessground/api';\n",
    '',
    'OnlineArena direct Chessground imports');
  source = replaceRequired(source,
    "import CapturedPieces from '../ui/CapturedPieces';\n",
    "import CapturedPieces from '../ui/CapturedPieces';\nimport ChessBoardSurface, { type QQurzChessgroundApi, type QQurzChessgroundConfig } from '../ui/ChessBoardSurface';\nimport ChessPieceAsset from '../ui/ChessPieceAsset';\n",
    'OnlineArena shared UI imports');
  source = replaceRequired(source,
    "  const boardRef = useRef<HTMLDivElement | null>(null);\n  const ground = useRef<ChessgroundApi | null>(null);\n",
    "  const ground = useRef<QQurzChessgroundApi | null>(null);\n",
    'OnlineArena board refs');
  source = replaceRequired(source,
`  useEffect(() => {
    if (!boardRef.current || !snapshot) return;
    ground.current?.destroy();
    ground.current = Chessground(boardRef.current, {
      orientation: seat?.color ?? 'white', coordinates: true, coordinatesOnSquares: true,
      blockTouchScroll: true, disableContextMenu: true, autoCastle: true,
      movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
    });
    syncBoard();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => ground.current?.redrawAll()) : null;
    observer?.observe(boardRef.current);
    return () => { observer?.disconnect(); ground.current?.destroy(); ground.current = null; };
  }, [snapshot?.code]);
`, '', 'OnlineArena direct Chessground mount');
  source = replaceRequired(source,
    "  useEffect(() => syncBoard(), [syncBoard]);\n\n  const setRoomUrl = (code: string) => {",
`  useEffect(() => syncBoard(), [syncBoard]);
  const boardConfig = useMemo<QQurzChessgroundConfig>(() => ({
    fen: snapshot?.fen,
    orientation: seat?.color ?? 'white',
    turnColor: snapshot?.turn ?? 'white',
    coordinates: true,
    coordinatesOnSquares: true,
    blockTouchScroll: true,
    disableContextMenu: true,
    autoCastle: true,
    movable: { free: false, rookCastle: true, events: { after: (orig, dest) => moveHandler.current(orig, dest) } },
  }), [seat?.color, snapshot?.code, snapshot?.fen, snapshot?.turn]);

  const setRoomUrl = (code: string) => {`,
    'OnlineArena board config');
  source = replaceRequired(source,
    '            <div ref={boardRef} className="cg-wrap board-mount" aria-label="Online Chess960 board" />',
`            <ChessBoardSurface
              apiRef={ground}
              instanceKey={snapshot.code}
              config={boardConfig}
              ariaLabel="Online Chess960 board"
              onReady={() => syncBoard()}
            />`,
    'OnlineArena board element');
  source = replaceRequired(source,
    `{promotion && <div className="online-promotion" role="dialog" aria-label="Choose online promotion piece"><div><b>Promote pawn</b><button onClick={() => choosePromotion('q')}>♕ Queen</button><button onClick={() => choosePromotion('r')}>♖ Rook</button><button onClick={() => choosePromotion('b')}>♗ Bishop</button><button onClick={() => choosePromotion('n')}>♘ Knight</button></div></div>}`,
    `{promotion && <div className="online-promotion" role="dialog" aria-label="Choose online promotion piece"><div><b>Promote pawn</b><button onClick={() => choosePromotion('q')}><ChessPieceAsset role="queen" color={snapshot?.turn ?? seat.color} size="lg" /><span>Queen</span></button><button onClick={() => choosePromotion('r')}><ChessPieceAsset role="rook" color={snapshot?.turn ?? seat.color} size="lg" /><span>Rook</span></button><button onClick={() => choosePromotion('b')}><ChessPieceAsset role="bishop" color={snapshot?.turn ?? seat.color} size="lg" /><span>Bishop</span></button><button onClick={() => choosePromotion('n')}><ChessPieceAsset role="knight" color={snapshot?.turn ?? seat.color} size="lg" /><span>Knight</span></button></div></div>}`,
    'OnlineArena promotion Unicode pieces');

  const clockRow = source.match(/\n          <div className="online-clock-row">[\s\S]*?<\/div><\/div>\n/);
  if (!clockRow) throw new Error('Missing migration target: OnlineArena player clock row');
  source = source.replace(clockRow[0], '\n');
  source = replaceRequired(source,
    '          <CapturedPieces fen={snapshot.fen} orientation={seat.color} />\n',
    `          <CapturedPieces fen={snapshot.fen} orientation={seat.color} />\n${clockRow[0]}`,
    'OnlineArena captured/player information adjacency');
  fs.writeFileSync(path, source);
}

console.log('Shared Chessground renderer applied to active 2D board views.');
