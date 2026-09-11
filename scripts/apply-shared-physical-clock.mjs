import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  return source.replace(from, to);
}
function replaceRegexRequired(source, regex, to, label) {
  if (!regex.test(source)) throw new Error(`Missing ${label}`);
  return source.replace(regex, to);
}

// Local Human vs Human + AI: same physical component and state-driven slap sound.
{
  const path = 'src/LocalGame.tsx';
  let source = read(path);
  source = replaceRequired(source,
    "import ChessClock2D from './ui/ChessClock2D';",
    "import PhysicalChessClock from './ui/PhysicalChessClock';",
    'LocalGame physical clock import');
  source = replaceRequired(source,
`  useEffect(() => {
    if (phase !== 'playing' || mode !== 'ai' || !aiColor || pendingSlap !== aiColor) return;
    const timer = window.setTimeout(() => {
      playChessSound('slap');
      setPendingSlap(null);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [aiColor, mode, pendingSlap, phase]);`,
`  useEffect(() => {
    if (phase !== 'playing' || mode !== 'ai' || !aiColor || !pendingSlap) return;
    // AI mode is hands-free: both the human and Stockfish clock press are
    // acknowledged from the same pendingSlap state that owns timer transfer.
    const delay = pendingSlap === aiColor ? 220 : 120;
    const timer = window.setTimeout(() => setPendingSlap(null), delay);
    return () => window.clearTimeout(timer);
  }, [aiColor, mode, pendingSlap, phase]);`,
    'LocalGame AI clock transfer');
  source = replaceRequired(source,
`  const slapClock = useCallback(() => {
    if (!pendingSlap || phase !== 'playing') return;
    playChessSound('slap');
    setPendingSlap(null);
  }, [pendingSlap, phase]);`,
`  const slapClock = useCallback(() => {
    if (!pendingSlap || phase !== 'playing') return;
    setPendingSlap(null);
  }, [pendingSlap, phase]);`,
    'LocalGame manual clock transfer');
  source = source.replaceAll('ChessClock2D', 'PhysicalChessClock');
  write(path, source);
}

// Friend + Tournament: server snapshot remains authoritative; shared component
// waits for the server to clear awaitingClockPress before animating/sounding.
{
  const path = 'src/multiplayer/OnlineArena.tsx';
  let source = read(path);
  source = replaceRequired(source,
    "import ChessClock3DView from '../ui/ChessClock3DView';",
    "import PhysicalChessClock from '../ui/PhysicalChessClock';",
    'OnlineArena physical clock import');
  source = replaceRegexRequired(source,
/          <section className=\{`qqurz-physical-clock-panel online-physical-clock match-clock-panel \$\{showClock \? '' : 'clock-hidden'\}`\} aria-label="Online 3D tournament clock">[\s\S]*?          <\/section>\n\n          \{colorBidAllowed/,
`          <PhysicalChessClock
            whiteSeconds={whiteMs / 1000}
            blackSeconds={blackMs / 1000}
            activeColor={snapshot.status === 'playing' ? snapshot.activeClock : null}
            pendingSlap={snapshot.awaitingClockPress}
            disabled={snapshot.awaitingClockPress !== seat.color}
            onSlap={() => send({ type: 'clock_slap' })}
            compact
            visible={showClock}
            onVisibleChange={setClockVisible}
            className="online-physical-clock match-clock-panel"
          />

          {colorBidAllowed`,
    'OnlineArena clock panel');
  write(path, source);
}

// Premium 3D: remove its embedded second clock implementation and render the
// same reusable physical component directly below the 3D board.
{
  const path = 'src/premium/PremiumBoard3D.tsx';
  let source = read(path);
  source = replaceRequired(source,
    "import { createChessClock3D, type ChessClock3DModel } from './chessClock3D';",
    "import PhysicalChessClock from '../ui/PhysicalChessClock';\nimport { clockVisible as getClockVisible, setClockVisible, subscribeClockVisible } from '../ui/clockPreference';",
    'Premium physical clock import');
  source = source.replace('  clock: ChessClock3DModel;\n', '');
  source = source.replace("const CLOCK_VISIBLE_KEY = 'qqurz:physical-clock-visible';\n", '');
  source = replaceRegexRequired(source,
/function initialClockVisible\(\): boolean \{[\s\S]*?\}\n\nfunction resultOf/,
'function resultOf',
    'Premium legacy visibility helper');
  source = source.replace('  const slapRef = useRef<() => void>(() => {});\n', '');
  source = replaceRequired(source,
    '  const [clockVisible, setClockVisible] = useState(initialClockVisible);',
    '  const [showClock, setShowClock] = useState(getClockVisible);',
    'Premium clock visibility state');
  source = replaceRequired(source,
    "  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;",
    "  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;\n  useEffect(() => subscribeClockVisible(setShowClock), []);",
    'Premium visibility subscription');
  source = replaceRegexRequired(source,
/    \/\/ The clock is a separate full 3D object directly below\/near-side of the board\.[\s\S]*?    scene\.add\(clock\.group\);\n\n/,
'',
    'Premium embedded clock scene object');
  source = source.replace(
    '    const ray = new THREE.Raycaster(); let down: Key | null = null, downRocker = false, moved = false, sx = 0, sy = 0;',
    '    const ray = new THREE.Raycaster(); let down: Key | null = null, moved = false, sx = 0, sy = 0;');
  source = replaceRegexRequired(source,
/    const pickRocker = .*?;\n/,
'',
    'Premium rocker picker');
  source = replaceRequired(source,
    "    const pd = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; moved = false; downRocker = pickRocker(e); down = downRocker ? null : pickSquare(e); };",
    "    const pd = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; moved = false; down = pickSquare(e); };",
    'Premium pointer down');
  source = replaceRequired(source,
    "    const pu = (e: PointerEvent) => { if (moved) return; if (downRocker && pickRocker(e)) { slapRef.current(); return; } const up = pickSquare(e); if (down && up && down === up) selectRef.current(up); };",
    "    const pu = (e: PointerEvent) => { if (moved) return; const up = pickSquare(e); if (down && up && down === up) selectRef.current(up); };",
    'Premium pointer up');
  source = replaceRequired(source,
    'sceneRef.current = { scene, camera, renderer, controls, board, pieces, selection, squares, clock };',
    'sceneRef.current = { scene, camera, renderer, controls, board, pieces, selection, squares };',
    'Premium scene handle');
  source = source.replace('scene.remove(clock.group); clock.dispose(); ', '');
  source = replaceRegexRequired(source,
/  useEffect\(\(\) => \{ const h = sceneRef\.current; if \(!h\) return; h\.clock\.update\([\s\S]*?\}, \[blackClock, pendingSlap, phase, turn, whiteClock\]\);\n/,
'',
    'Premium embedded clock update effect');
  source = replaceRegexRequired(source,
/  useEffect\(\(\) => \{\n    try \{ window\.localStorage\.setItem\(CLOCK_VISIBLE_KEY,[\s\S]*?  \}, \[clockVisible\]\);\n/,
'',
    'Premium legacy visibility effect');
  source = replaceRegexRequired(source,
/  useEffect\(\(\) => \{ if \(phase !== 'playing' \|\| mode !== 'ai' \|\| !aiColor \|\| pendingSlap !== aiColor\) return; const timer = window\.setTimeout\(\(\) => \{ sceneRef\.current\?\.clock\.slap\(aiColor\); playChessSound\('slap'\); setPendingSlap\(null\); \}, 260\); return \(\) => window\.clearTimeout\(timer\); \}, \[aiColor, mode, pendingSlap, phase\]\);/,
"  useEffect(() => { if (phase !== 'playing' || mode !== 'ai' || !aiColor || !pendingSlap) return; const delay = pendingSlap === aiColor ? 220 : 120; const timer = window.setTimeout(() => setPendingSlap(null), delay); return () => window.clearTimeout(timer); }, [aiColor, mode, pendingSlap, phase]);",
    'Premium AI clock transfer');
  source = replaceRequired(source,
    "  const slapClock = () => { if (!pendingSlap || pendingSlap === aiColor) return; if (clockVisible) sceneRef.current?.clock.slap(pendingSlap); playChessSound('slap'); setPendingSlap(null); };\n  slapRef.current = slapClock;",
    "  const slapClock = () => { if (!pendingSlap || pendingSlap === aiColor) return; setPendingSlap(null); };",
    'Premium manual clock transfer');

  // From this point the legacy local visibility variable no longer exists.
  source = source.replaceAll('clockVisible', 'showClock');
  source = source.replaceAll('setClockVisible(v => !v)', 'setClockVisible(!showClock)');
  source = replaceRegexRequired(source,
/<div ref=\{mount\} className="three-board-mount" aria-label="Interactive 3D chess board and tournament clock"\/><div className="three-preview-badge">PREMIUM 3D<\/div><div className="three-board-help">Tap piece, then destination\{showClock \? ' · slap the curved white rocker after your move' : ''\}<\/div>\{showClock && <div className=\{`three-clock-hint \$\{phase === 'playing' && pendingSlap && pendingSlap !== aiColor \? 'ready' : ''\}`\}>\{phase === 'playing' && pendingSlap && pendingSlap !== aiColor \? `TAP 3D CLOCK · \$\{pendingSlap\.toUpperCase\(\)\}` : 'PHYSICAL 3D CLOCK · LIVE LCD'\}<\/div>\}/,
'<div ref={mount} className="three-board-mount" aria-label="Interactive 3D chess board"/><div className="three-preview-badge">PREMIUM 3D</div><div className="three-board-help">Tap piece, then destination</div>',
    'Premium board clock hint');
  source = replaceRequired(source,
    '</section></div><aside className="three-side-column">',
    `</section><PhysicalChessClock whiteSeconds={whiteClock} blackSeconds={blackClock} activeColor={phase === 'playing' ? (pendingSlap ?? turn) : null} pendingSlap={pendingSlap} disabled={!pendingSlap || pendingSlap === aiColor} onSlap={slapClock} compact visible={showClock} onVisibleChange={setClockVisible} className="premium-physical-clock" /></div><aside className="three-side-column">`,
    'Premium reusable clock placement');
  source = replaceRegexRequired(source,
/<\/div><div className="three-clocks"><div className=\{\(pendingSlap \?\? turn\) === 'black'[\s\S]*?<\/div><\/div>\{phase === 'playing'/,
'</div>{phase === \'playing\'',
    'Premium duplicate timer cards');
  source = source.replace('Full 3D curved rocker, sides, rear details and rubber feet.', 'True-depth curved rocker and housing; invisible underside detail is intentionally omitted for mobile FPS.');
  source = source.replace('One shared model for local Human vs Human and Stockfish AI.', 'The same reusable physical clock component is used in every QQURZ game mode.');
  write(path, source);
}

// Give the reusable Premium clock breathing room below the board without a new
// breakpoint or screen-specific stylesheet.
{
  const path = 'src/styles/board.css';
  let source = read(path);
  const rule = '.premium-physical-clock{margin-top:var(--q-space-12)}';
  if (!source.includes(rule)) source += `\n${rule}\n`;
  write(path, source);
}

console.log('QQURZ shared physical clock migration applied.');
