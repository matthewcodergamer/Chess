import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Move, Role, SquareName } from 'chessops/types';
import { parseSquare, parseUci } from 'chessops/util';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { chess960BackRank, chess960Fen, randomChess960Id } from '../game/chess960';

type Props = { onBack: () => void };
type GameMode = 'human' | 'ai';
type Phase = 'setup' | 'strategy' | 'playing' | 'ended';
type Difficulty = 'easy' | 'hard' | 'crazy';
type SideChoice = 'white' | 'black' | 'random';
type PromotionRole = Extract<Role, 'queen' | 'rook' | 'bishop' | 'knight'>;
type EngineStatus = 'off' | 'loading' | 'ready' | 'thinking' | 'error';
type Engine = { init: () => Promise<void>; isReady: () => boolean; bestMove: (fen: string, difficulty: Difficulty) => Promise<string>; cancelSearch: () => void; destroy: () => void };
type FenPiece = { square: SquareName; color: Color; role: Role };
type SceneHandle = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls; board: THREE.Group; pieces: THREE.Group; hints: THREE.Group; squares: THREE.Mesh[] };

const GAME_SECONDS = 600;
const STRATEGY_SECONDS = 120;
const DEFAULT_CAMERA = new THREE.Vector3(0, 13.6, 12.2);
const DIFFICULTIES: Record<Difficulty, { label: string; note: string }> = {
  easy: { label: 'Easy', note: 'Relaxed and forgiving' },
  hard: { label: 'Hard', note: 'Strong club-level play' },
  crazy: { label: 'Crazy Hard', note: 'Full-power Stockfish' },
};

function fmt(value: number) { const s = Math.max(0, Math.ceil(value)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function opposite(color: Color): Color { return color === 'white' ? 'black' : 'white'; }
function chooseColor(choice: SideChoice): Color { return choice === 'random' ? (Math.random() < .5 ? 'white' : 'black') : choice; }
function resultOf(pos: Chess): string | null {
  if (pos.isCheckmate()) return pos.turn === 'white' ? 'Black wins by checkmate' : 'White wins by checkmate';
  if (pos.isStalemate()) return 'Draw by stalemate';
  if (pos.isInsufficientMaterial()) return 'Draw by insufficient material';
  return pos.isEnd() ? 'Game over' : null;
}
function squarePos(square: SquareName) { return { x: square.charCodeAt(0) - 100.5, z: 4.5 - Number(square[1]) }; }
function boardPieces(fen: string): FenPiece[] {
  const out: FenPiece[] = [];
  (fen.split(' ')[0]?.split('/') ?? []).forEach((row, rowIndex) => {
    let file = 0;
    for (const char of row) {
      if (/\d/.test(char)) { file += Number(char); continue; }
      const lower = char.toLowerCase();
      const role: Role = lower === 'p' ? 'pawn' : lower === 'r' ? 'rook' : lower === 'n' ? 'knight' : lower === 'b' ? 'bishop' : lower === 'q' ? 'queen' : 'king';
      out.push({ square: `${String.fromCharCode(97 + file)}${8 - rowIndex}` as SquareName, color: char === char.toUpperCase() ? 'white' : 'black', role });
      file += 1;
    }
  });
  return out;
}
function m(geometry: THREE.BufferGeometry, material: THREE.Material, y = 0) {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.y = y; mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}
function smoothPawnBase(material: THREE.MeshStandardMaterial) {
  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(.31, 0),
    new THREE.Vector2(.39, .035),
    new THREE.Vector2(.40, .075),
    new THREE.Vector2(.34, .12),
    new THREE.Vector2(.27, .17),
    new THREE.Vector2(.22, .225),
  ];
  return m(new THREE.LatheGeometry(profile, 30), material);
}
function piece(role: Role, material: THREE.MeshStandardMaterial) {
  const g = new THREE.Group();
  const seg = 24;

  if (role === 'pawn') {
    g.add(smoothPawnBase(material));
    g.add(m(new THREE.CylinderGeometry(.135, .205, .36, seg), material, .385));
    const collar = m(new THREE.TorusGeometry(.18, .026, 12, 28), material, .575); collar.rotation.x = Math.PI / 2; g.add(collar);
    g.add(m(new THREE.SphereGeometry(.18, 24, 18), material, .755));
    return g;
  }

  g.add(m(new THREE.CylinderGeometry(.36, .42, .10, seg), material, .05));
  g.add(m(new THREE.CylinderGeometry(.27, .34, .08, seg), material, .15));
  const ring = m(new THREE.TorusGeometry(.23, .032, 12, 28), material, .25); ring.rotation.x = Math.PI / 2; g.add(ring);
  if (role === 'rook') {
    g.add(m(new THREE.CylinderGeometry(.20, .24, .56, seg), material, .48)); g.add(m(new THREE.CylinderGeometry(.30, .23, .12, seg), material, .82));
    for (let i = 0; i < 4; i++) { const c = m(new THREE.BoxGeometry(.09, .12, .16), material, .96); const a = i * Math.PI / 2; c.position.x = Math.cos(a) * .2; c.position.z = Math.sin(a) * .2; g.add(c); }
  } else if (role === 'knight') {
    g.add(m(new THREE.CylinderGeometry(.18, .24, .34, seg), material, .38)); const neck = m(new THREE.CapsuleGeometry(.15, .38, 6, 14), material, .68); neck.rotation.z = -.38; neck.position.x = .08; g.add(neck); const head = m(new THREE.BoxGeometry(.26, .24, .20), material, .95); head.rotation.z = -.26; head.position.x = .2; g.add(head); const ear = m(new THREE.ConeGeometry(.06, .14, 10), material, 1.1); ear.position.x = .14; g.add(ear);
  } else if (role === 'bishop') {
    g.add(m(new THREE.CylinderGeometry(.15, .22, .58, seg), material, .49)); g.add(m(new THREE.SphereGeometry(.15, 18, 14), material, .87)); const slit = m(new THREE.BoxGeometry(.04, .22, .20), material, .95); slit.rotation.z = .65; g.add(slit); g.add(m(new THREE.SphereGeometry(.06, 14, 10), material, 1.09));
  } else if (role === 'queen') {
    g.add(m(new THREE.CylinderGeometry(.16, .23, .67, seg), material, .51)); g.add(m(new THREE.CylinderGeometry(.27, .17, .16, seg), material, .92)); for (let i = 0; i < 6; i++) { const j = m(new THREE.SphereGeometry(.05, 12, 10), material, 1.08); const a = i * Math.PI / 3; j.position.x = Math.cos(a) * .13; j.position.z = Math.sin(a) * .13; g.add(j); } g.add(m(new THREE.SphereGeometry(.08, 16, 12), material, 1.1));
  } else {
    g.add(m(new THREE.CylinderGeometry(.16, .24, .70, seg), material, .52)); g.add(m(new THREE.SphereGeometry(.15, 18, 14), material, .95)); g.add(m(new THREE.BoxGeometry(.08, .28, .08), material, 1.18)); g.add(m(new THREE.BoxGeometry(.24, .06, .08), material, 1.18));
  }
  return g;
}
function clearGeometry(group: THREE.Group) { group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); group.clear(); }

export default function PremiumBoard3D({ onBack }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const position = useRef<Chess | null>(null);
  const engine = useRef<Engine | null>(null);
  const enginePromise = useRef<Promise<Engine> | null>(null);
  const selectRef = useRef<(square: SquareName) => void>(() => {});

  const [mode, setMode] = useState<GameMode>('human');
  const [phase, setPhase] = useState<Phase>('setup');
  const [positionId, setPositionId] = useState<number | null>(null);
  const [fen, setFen] = useState('');
  const [turn, setTurn] = useState<Color>('white');
  const [viewColor, setViewColor] = useState<Color>('white');
  const [moves, setMoves] = useState<string[]>([]);
  const [whiteClock, setWhiteClock] = useState(GAME_SECONDS);
  const [blackClock, setBlackClock] = useState(GAME_SECONDS);
  const [strategyTime, setStrategyTime] = useState(STRATEGY_SECONDS);
  const [fastForward, setFastForward] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('hard');
  const [sideChoice, setSideChoice] = useState<SideChoice>('white');
  const [humanColor, setHumanColor] = useState<Color | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('off');
  const [engineError, setEngineError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [selected, setSelected] = useState<SquareName | null>(null);
  const [promotion, setPromotion] = useState<{ orig: SquareName; dest: SquareName } | null>(null);

  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);
  const ensureEngine = useCallback(async () => {
    if (engine.current) return engine.current;
    if (!enginePromise.current) enginePromise.current = import('../engine/stockfish').then(({ StockfishEngine }) => (engine.current = new StockfishEngine() as Engine));
    return enginePromise.current;
  }, []);
  const humanCanMove = useCallback((pos: Chess) => phase === 'playing' && (mode === 'human' || humanColor === pos.turn), [humanColor, mode, phase]);

  const sync3D = useCallback(() => {
    const h = sceneRef.current;
    const pos = position.current;
    if (!h || !fen) return;
    h.board.rotation.y = viewColor === 'black' ? Math.PI : 0;
    clearGeometry(h.pieces); clearGeometry(h.hints);
    const white = h.scene.userData.white as THREE.MeshStandardMaterial;
    const black = h.scene.userData.black as THREE.MeshStandardMaterial;
    const selectedMat = h.scene.userData.selected as THREE.MeshStandardMaterial;
    const legalMat = h.scene.userData.legal as THREE.MeshStandardMaterial;
    for (const item of boardPieces(fen)) {
      const obj = piece(item.role, item.color === 'white' ? white : black); const p = squarePos(item.square); obj.position.set(p.x, .12, p.z); if (item.color === 'black') obj.rotation.y = Math.PI; h.pieces.add(obj);
    }
    if (selected && pos) {
      const p = squarePos(selected); const hi = m(new THREE.CylinderGeometry(.37, .37, .03, 28), selectedMat, .12); hi.position.set(p.x, .12, p.z); h.hints.add(hi);
      for (const dest of chessgroundDests(pos, { chess960: true }).get(selected) ?? []) { const d = squarePos(dest); const dot = m(new THREE.CylinderGeometry(.18, .18, .03, 22), legalMat, .12); dot.position.set(d.x, .12, d.z); h.hints.add(dot); }
    }
    h.renderer.render(h.scene, h.camera);
  }, [fen, selected, viewColor]);

  const createPosition = useCallback(() => {
    const id = randomChess960Id(); const pos = Chess.fromSetup(parseFen(chess960Fen(id)).unwrap()).unwrap(); const chosen = mode === 'ai' ? chooseColor(sideChoice) : null;
    position.current = pos; setPositionId(id); setFen(makeFen(pos.toSetup())); setTurn('white'); setViewColor(chosen ?? 'white'); setHumanColor(chosen); setMoves([]); setWhiteClock(GAME_SECONDS); setBlackClock(GAME_SECONDS); setStrategyTime(STRATEGY_SECONDS); setFastForward(false); setResult(null); setSelected(null); setPromotion(null); setEngineError(''); setPhase('strategy');
  }, [mode, sideChoice]);

  const finishMove = useCallback((move: Move) => {
    const pos = position.current; if (!pos || phase !== 'playing' || !pos.isLegal(move)) return false;
    const san = makeSan(pos, move); pos.play(move); setFen(makeFen(pos.toSetup())); setTurn(pos.turn); setMoves(v => [...v, san]); setSelected(null);
    const end = resultOf(pos); if (end) { setResult(end); setPhase('ended'); engine.current?.cancelSearch(); }
    return true;
  }, [phase]);

  const moveSquare = useCallback((orig: SquareName, dest: SquareName) => {
    const pos = position.current; if (!pos || !humanCanMove(pos)) return;
    const sq = parseSquare(orig); const pc = sq === undefined ? undefined : pos.board.get(sq);
    if (pc?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) { setPromotion({ orig, dest }); return; }
    const move = parseUci(`${orig}${dest}`); if (move) finishMove(move);
  }, [finishMove, humanCanMove]);

  const chooseSquare = useCallback((square: SquareName) => {
    const pos = position.current; if (!pos || !humanCanMove(pos)) return;
    const sq = parseSquare(square); const pc = sq === undefined ? undefined : pos.board.get(sq);
    if (selected) {
      const legal = chessgroundDests(pos, { chess960: true }).get(selected) ?? [];
      if (legal.includes(square)) { moveSquare(selected, square); return; }
      if (pc?.color === pos.turn) { setSelected(square); return; }
      setSelected(null); return;
    }
    if (pc?.color === pos.turn) setSelected(square);
  }, [humanCanMove, moveSquare, selected]);
  selectRef.current = chooseSquare;

  const promote = (role: PromotionRole) => {
    if (!promotion) return; const suffix = role === 'queen' ? 'q' : role === 'rook' ? 'r' : role === 'bishop' ? 'b' : 'n'; const move = parseUci(`${promotion.orig}${promotion.dest}${suffix}`); setPromotion(null); if (move) finishMove(move);
  };

  const resetCamera = useCallback(() => {
    const h = sceneRef.current;
    if (!h) return;
    h.camera.position.copy(DEFAULT_CAMERA);
    h.controls.target.set(0, .45, 0);
    h.controls.update();
    h.renderer.render(h.scene, h.camera);
  }, []);

  useEffect(() => {
    const element = mount.current; if (!element) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x17120f); scene.fog = new THREE.Fog(0x17120f, 18, 34);
    const camera = new THREE.PerspectiveCamera(32, 1, .1, 100); camera.position.copy(DEFAULT_CAMERA); camera.lookAt(0, .45, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.28; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; element.replaceChildren(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = false; controls.enableZoom = true; controls.zoomSpeed = .72; controls.rotateSpeed = .55; controls.minDistance = 14.2; controls.maxDistance = 20; controls.minPolarAngle = .55; controls.maxPolarAngle = .98; controls.minAzimuthAngle = -.58; controls.maxAzimuthAngle = .58; controls.target.set(0, .45, 0); controls.update(); controls.addEventListener('change', () => renderer.render(scene, camera));

    const shell = new THREE.MeshStandardMaterial({ color: 0x2a1d16, roughness: .66, metalness: .12 });
    const inset = new THREE.MeshStandardMaterial({ color: 0x3a281e, roughness: .72, metalness: .08 });
    const lightSq = new THREE.MeshStandardMaterial({ color: 0x9b7859, roughness: .78, metalness: .02 });
    const darkSq = new THREE.MeshStandardMaterial({ color: 0x4b3526, roughness: .84, metalness: .02 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5ead9, roughness: .38, metalness: .04 });
    const black = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: .34, metalness: .07 });
    const selectedMat = new THREE.MeshStandardMaterial({ color: 0x66d7ad, emissive: 0x1b5d48, transparent: true, opacity: .9 });
    const legalMat = new THREE.MeshStandardMaterial({ color: 0x8de6c2, emissive: 0x14392d, transparent: true, opacity: .55 });
    scene.userData.white = white; scene.userData.black = black; scene.userData.selected = selectedMat; scene.userData.legal = legalMat;
    const board = new THREE.Group(), pieces = new THREE.Group(), hints = new THREE.Group(); scene.add(board); board.add(pieces, hints);
    board.add(m(new THREE.BoxGeometry(9.2, .48, 9.2), shell, -.24)); board.add(m(new THREE.BoxGeometry(8.7, .14, 8.7), inset, -.03));
    const squares: THREE.Mesh[] = [];
    for (let rank = 1; rank <= 8; rank++) for (let file = 0; file < 8; file++) { const square = `${String.fromCharCode(97 + file)}${rank}` as SquareName; const p = squarePos(square); const tile = m(new THREE.BoxGeometry(1, .08, 1), (file + rank) % 2 === 0 ? darkSq : lightSq, .04); tile.position.set(p.x, .04, p.z); tile.userData.square = square; squares.push(tile); board.add(tile); }
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: .94 }); const floor = m(new THREE.CylinderGeometry(9.8, 10.3, .12, 48), floorMat, -.45); scene.add(floor);
    scene.add(new THREE.AmbientLight(0xffffff, .42));
    scene.add(new THREE.HemisphereLight(0xfff4e4, 0x5a4638, 2.15));
    const fill = new THREE.DirectionalLight(0xffdcc0, 1.12); fill.position.set(-6, 9, 4); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xcbe8ff, .58); rim.position.set(5, 5, -7); scene.add(rim);
    const key = new THREE.DirectionalLight(0xfff8ef, 3.35); key.position.set(4.8, 9.5, 6.2); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = .1; key.shadow.camera.far = 30; key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 7; key.shadow.camera.bottom = -7; key.shadow.bias = -.00008; key.shadow.normalBias = .018; scene.add(key, key.target); key.target.position.set(0, .2, 0);
    const ray = new THREE.Raycaster(); let down: SquareName | null = null, moved = false, sx = 0, sy = 0;
    const pick = (e: PointerEvent): SquareName | null => { const r = renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1, -(((e.clientY-r.top)/r.height)*2-1)), camera); return (ray.intersectObjects(squares, false)[0]?.object.userData.square as SquareName | undefined) ?? null; };
    const pd = (e: PointerEvent) => { sx=e.clientX; sy=e.clientY; moved=false; down=pick(e); };
    const pm = (e: PointerEvent) => { if (Math.abs(e.clientX-sx)>7 || Math.abs(e.clientY-sy)>7) moved=true; };
    const pu = (e: PointerEvent) => { if (moved) return; const up=pick(e); if (down && up && down===up) selectRef.current(up); };
    renderer.domElement.addEventListener('pointerdown', pd); renderer.domElement.addEventListener('pointermove', pm); renderer.domElement.addEventListener('pointerup', pu); renderer.domElement.addEventListener('pointercancel', pu);
    const resize = () => { const r=element.getBoundingClientRect(); const w=Math.max(1,r.width), h=Math.max(1,r.height); renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.render(scene,camera); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); sceneRef.current={scene,camera,renderer,controls,board,pieces,hints,squares};
    return () => { observer.disconnect(); renderer.domElement.removeEventListener('pointerdown',pd); renderer.domElement.removeEventListener('pointermove',pm); renderer.domElement.removeEventListener('pointerup',pu); renderer.domElement.removeEventListener('pointercancel',pu); controls.dispose(); renderer.dispose(); const mats=new Set<THREE.Material>(); scene.traverse(o=>{ if(o instanceof THREE.Mesh){o.geometry.dispose(); const list=Array.isArray(o.material)?o.material:[o.material]; list.forEach(x=>mats.add(x));}}); mats.forEach(x=>x.dispose()); sceneRef.current=null; element.replaceChildren(); };
  }, []);

  useEffect(() => { sync3D(); }, [sync3D]);
  useEffect(() => {
    if (mode !== 'ai' || positionId === null) { setEngineStatus('off'); return; }
    let cancelled=false; setEngineStatus('loading'); void ensureEngine().then(e=>e.init()).then(()=>{if(!cancelled)setEngineStatus('ready');}).catch(err=>{if(!cancelled){setEngineStatus('error');setEngineError(err instanceof Error?err.message:'Stockfish failed to load.');}}); return()=>{cancelled=true;};
  }, [ensureEngine, mode, positionId]);
  useEffect(() => {
    if (phase !== 'strategy') return; if (strategyTime <= 0) { setFastForward(false); setPhase('playing'); return; } const timer=window.setTimeout(()=>setStrategyTime(v=>Math.max(0,v-1)),fastForward?250:1000); return()=>window.clearTimeout(timer);
  }, [fastForward,phase,strategyTime]);
  useEffect(() => {
    if (phase !== 'playing') return; const timer=window.setInterval(()=>{ const pos=position.current; if(!pos)return; if(mode==='ai'&&pos.turn===aiColor&&engineStatus==='loading')return; const setter=pos.turn==='white'?setWhiteClock:setBlackClock; setter(v=>{const n=Math.max(0,v-1); if(n===0){setResult(pos.turn==='white'?'Black wins on time':'White wins on time');setPhase('ended');engine.current?.cancelSearch();} return n;});},1000); return()=>window.clearInterval(timer);
  },[aiColor,engineStatus,mode,phase]);
  useEffect(() => {
    const pos=position.current; if(phase!=='playing'||mode!=='ai'||!aiColor||!pos||pos.turn!==aiColor||result)return; let cancelled=false; const snapshot=makeFen(pos.toSetup()); void (async()=>{try{const e=await ensureEngine(); if(!e.isReady()){setEngineStatus('loading');await e.init();} if(cancelled)return;setEngineStatus('thinking');const uci=await e.bestMove(snapshot,difficulty);const current=position.current;if(cancelled||!current||current.turn!==aiColor||makeFen(current.toSetup())!==snapshot)return;const move=parseUci(uci);if(!move||!current.isLegal(move))throw new Error('Stockfish returned an invalid move.');finishMove(move);setEngineStatus('ready');}catch(err){if(!cancelled){setEngineStatus('error');setEngineError(err instanceof Error?err.message:'Stockfish could not move.');}}})(); return()=>{cancelled=true;engine.current?.cancelSearch();};
  },[aiColor,difficulty,ensureEngine,fen,finishMove,mode,phase,result,turn]);
  useEffect(()=>()=>engine.current?.destroy(),[]);

  const startNow=()=>{if(phase==='strategy'){setStrategyTime(0);setFastForward(false);setPhase('playing');}};
  const playerName=(color:Color)=>mode==='ai'&&aiColor===color?`Stockfish · ${DIFFICULTIES[difficulty].label}`:mode==='ai'?'You':color==='white'?'White':'Black';

  return <div className="premium-page-v14 qqurz-content-page three-play-page">
    <section className="page-heading-v14 compact"><button className="text-back" onClick={onBack}>← Home</button><span className="qqurz-kicker">PREMIUM 3D</span><h1>Warm, readable 3D chess.</h1><p>A farther-back angled view, brighter studio lighting, true black-and-ivory pieces and a dark-brown / light-brown board.</p></section>
    <section className="three-setup-card">
      <div className="local-mode-switch"><button className={mode==='human'?'selected':''} onClick={()=>setMode('human')}>Human vs Human</button><button className={mode==='ai'?'selected':''} onClick={()=>setMode('ai')}>Play AI</button></div>
      {mode==='ai'&&<div className="local-ai-options"><div><span>AI strength</span><div className="option-pills">{(Object.keys(DIFFICULTIES) as Difficulty[]).map(level=><button key={level} className={difficulty===level?'selected':''} onClick={()=>setDifficulty(level)}><b>{DIFFICULTIES[level].label}</b><small>{DIFFICULTIES[level].note}</small></button>)}</div></div><div><span>Play as</span><div className="side-pills">{(['white','black','random'] as SideChoice[]).map(side=><button key={side} className={sideChoice===side?'selected':''} onClick={()=>setSideChoice(side)}>{side[0].toUpperCase()+side.slice(1)}</button>)}</div></div></div>}
      <div className="three-toolbar-row"><button className="primary-black" onClick={createPosition}>{phase==='setup'?'Create 3D Position':'New 3D Position'}</button><button className="secondary-clean" onClick={()=>setViewColor(v=>opposite(v))} disabled={positionId===null}>Flip view</button><button className="secondary-clean" onClick={resetCamera}>Reset camera</button><span className="three-inline-note">Drag to rotate · pinch/scroll to zoom · tap to move</span></div>
    </section>
    <section className="three-play-grid"><div className="three-main-column"><section className="three-board-card high-fidelity"><div ref={mount} className="three-board-mount" aria-label="Interactive 3D chess board"/><div className="three-preview-badge">PREMIUM 3D</div><div className="three-board-help">Drag to rotate · pinch/scroll to zoom · tap piece, then square</div>
      {phase==='strategy'&&<div className="local-board-overlay"><span>STRATEGY</span><strong>{fmt(strategyTime)}</strong><p>Study the Chess960 position. Hold to fast-forward or start now.</p><div><button onPointerDown={()=>setFastForward(true)} onPointerUp={()=>setFastForward(false)} onPointerCancel={()=>setFastForward(false)}>Hold ×4</button><button className="primary-black" onClick={startNow}>Start Now</button></div></div>}
      {phase==='ended'&&result&&<div className="local-board-overlay ended"><span>GAME OVER</span><strong className="end-title">{result}</strong><button className="primary-black" onClick={createPosition}>New position</button></div>}
    </section></div><aside className="three-side-column"><div className="three-panel"><span className="qqurz-kicker">POSITION {positionId!==null?`#${positionId}`:'—'}</span><h2>{backRank||'Open a 3D position'}</h2><p>{mode==='ai'?`You vs ${DIFFICULTIES[difficulty].label} Stockfish`:'Two players on one device'}</p></div><div className="three-clocks"><div className={turn==='black'&&phase==='playing'?'active':''}><span>{playerName('black')}</span><strong>{fmt(blackClock)}</strong></div><div className={turn==='white'&&phase==='playing'?'active':''}><span>{playerName('white')}</span><strong>{fmt(whiteClock)}</strong></div></div>{mode==='ai'&&<div className={`local-engine-state ${engineStatus}`}>{engineStatus==='loading'?'Loading Stockfish…':engineStatus==='thinking'?'Stockfish thinking…':engineStatus==='ready'?'Stockfish ready':engineError||'AI preparing'}</div>}<div className="three-panel muted"><span className="qqurz-kicker">RENDERING</span><ul className="three-note-list"><li>Warm walnut dark/light board squares.</li><li>Brighter studio fill with softer readable shadows.</li><li>Smoother pawn bases and a farther default camera.</li></ul></div><div className="three-panel moves"><span className="qqurz-kicker">MOVES</span>{moves.length?<ol>{moves.map((move,i)=><li key={`${move}-${i}`}>{move}</li>)}</ol>:<p>No moves yet.</p>}</div></aside></section>
    {promotion&&<div className="modal-backdrop" role="dialog" aria-modal="true"><div className="promotion-modal"><span className="qqurz-kicker">PROMOTION</span><h2>Choose a piece</h2><div className="promotion-grid"><button onClick={()=>promote('queen')}>♕ Queen</button><button onClick={()=>promote('rook')}>♖ Rook</button><button onClick={()=>promote('bishop')}>♗ Bishop</button><button onClick={()=>promote('knight')}>♘ Knight</button></div></div></div>}
  </div>;
}
