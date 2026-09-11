import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Key } from '@lichess-org/chessground/types';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { Move, Role } from 'chessops/types';
import { parseSquare, parseUci } from 'chessops/util';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { chess960BackRank, chess960Fen, randomChess960Id } from '../game/chess960';
import { useGameSession } from '../game/useGameSession';
import { canColorMove, clockOwner, sessionUiPhase, type GameResultKind } from '../../shared/gameSession';
import { adjudicateChess, appendPositionHistory, chessPositionKey } from '../../shared/chess960Rules';
import { playChessSound } from '../ui/sound';
import PhysicalChessClock from '../ui/PhysicalChessClock';
import { clockVisible as getClockVisible, setClockVisible, subscribeClockVisible } from '../ui/clockPreference';

type Props = { onBack: () => void };
type GameMode = 'human' | 'ai';
type Difficulty = 'easy' | 'hard' | 'crazy';
type SideChoice = 'white' | 'black' | 'random';
type PromotionRole = Extract<Role, 'queen' | 'rook' | 'bishop' | 'knight'>;
type EngineStatus = 'off' | 'loading' | 'ready' | 'thinking' | 'error';
type Engine = { init: () => Promise<void>; isReady: () => boolean; bestMove: (fen: string, difficulty: Difficulty) => Promise<string>; cancelSearch: () => void; destroy: () => void };
type FenPiece = { square: Key; color: Color; role: Role };
type SceneHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  board: THREE.Group;
  pieces: THREE.Group;
  selection: THREE.Group;
  squares: THREE.Mesh[];
};

const GAME_MS = 10 * 60 * 1000;
const STRATEGY_MS = 2 * 60 * 1000;
const DIFFICULTIES: Record<Difficulty, { label: string; note: string }> = {
  easy: { label: 'Easy', note: 'Relaxed and forgiving' },
  hard: { label: 'Hard', note: 'Strong club-level play' },
  crazy: { label: 'Crazy Hard', note: 'Full-power Stockfish' },
};

const fmt = (value: number) => {
  const s = Math.max(0, Math.ceil(value));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const opposite = (color: Color): Color => color === 'white' ? 'black' : 'white';
const chooseColor = (choice: SideChoice): Color => choice === 'random' ? (Math.random() < .5 ? 'white' : 'black') : choice;

function resultOf(pos: Chess, history: readonly string[]): { kind: GameResultKind; text: string; winner: Color | null } | null {
  return adjudicateChess(pos, history);
}

function squarePos(square: Key) {
  return { x: square.charCodeAt(0) - 100.5, z: 4.5 - Number(square[1]) };
}

function boardPieces(fen: string): FenPiece[] {
  const out: FenPiece[] = [];
  (fen.split(' ')[0]?.split('/') ?? []).forEach((row, rowIndex) => {
    let file = 0;
    for (const char of row) {
      if (/\d/.test(char)) { file += Number(char); continue; }
      const lower = char.toLowerCase();
      const role: Role = lower === 'p' ? 'pawn' : lower === 'r' ? 'rook' : lower === 'n' ? 'knight' : lower === 'b' ? 'bishop' : lower === 'q' ? 'queen' : 'king';
      out.push({ square: `${String.fromCharCode(97 + file)}${8 - rowIndex}` as Key, color: char === char.toUpperCase() ? 'white' : 'black', role });
      file += 1;
    }
  });
  return out;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, y = 0) {
  const value = new THREE.Mesh(geometry, material);
  value.position.y = y;
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

function addBase(group: THREE.Group, material: THREE.Material, compact = false) {
  const seg = 28;
  group.add(mesh(new THREE.CylinderGeometry(compact ? .31 : .35, compact ? .38 : .42, .09, seg), material, .045));
  group.add(mesh(new THREE.CylinderGeometry(compact ? .27 : .30, compact ? .33 : .36, .07, seg), material, .125));
  const ring = mesh(new THREE.TorusGeometry(compact ? .245 : .26, .028, 12, 28), material, .205);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
}

function piece(role: Role, material: THREE.Material) {
  const g = new THREE.Group();
  const seg = 28;
  addBase(g, material, role === 'pawn');
  if (role === 'pawn') {
    g.add(mesh(new THREE.CylinderGeometry(.135, .22, .37, seg), material, .42));
    const collar = mesh(new THREE.TorusGeometry(.17, .026, 12, 26), material, .64); collar.rotation.x = Math.PI / 2; g.add(collar);
    g.add(mesh(new THREE.SphereGeometry(.18, 24, 18), material, .79));
  } else if (role === 'rook') {
    g.add(mesh(new THREE.CylinderGeometry(.20, .245, .54, seg), material, .48));
    g.add(mesh(new THREE.CylinderGeometry(.30, .23, .12, seg), material, .81));
    for (let i = 0; i < 4; i++) { const c = mesh(new THREE.BoxGeometry(.10, .12, .17), material, .95); const a = i * Math.PI / 2; c.position.x = Math.cos(a) * .2; c.position.z = Math.sin(a) * .2; g.add(c); }
  } else if (role === 'knight') {
    g.add(mesh(new THREE.CylinderGeometry(.18, .24, .31, seg), material, .36));
    const neck = mesh(new THREE.CapsuleGeometry(.15, .39, 7, 14), material, .67); neck.rotation.z = -.38; neck.position.x = .08; g.add(neck);
    const head = mesh(new THREE.BoxGeometry(.27, .25, .21), material, .95); head.rotation.z = -.24; head.position.x = .2; g.add(head);
  } else if (role === 'bishop') {
    g.add(mesh(new THREE.CylinderGeometry(.15, .22, .57, seg), material, .48));
    g.add(mesh(new THREE.SphereGeometry(.155, 22, 16), material, .87));
    g.add(mesh(new THREE.SphereGeometry(.06, 16, 10), material, 1.09));
  } else if (role === 'queen') {
    g.add(mesh(new THREE.CylinderGeometry(.16, .23, .66, seg), material, .50));
    g.add(mesh(new THREE.CylinderGeometry(.27, .17, .15, seg), material, .91));
    for (let i = 0; i < 6; i++) { const j = mesh(new THREE.SphereGeometry(.052, 14, 10), material, 1.07); const a = i * Math.PI / 3; j.position.x = Math.cos(a) * .13; j.position.z = Math.sin(a) * .13; g.add(j); }
  } else {
    g.add(mesh(new THREE.CylinderGeometry(.16, .24, .69, seg), material, .51));
    g.add(mesh(new THREE.SphereGeometry(.15, 22, 16), material, .95));
    g.add(mesh(new THREE.BoxGeometry(.08, .28, .08), material, 1.18));
    g.add(mesh(new THREE.BoxGeometry(.24, .06, .08), material, 1.18));
  }
  return g;
}

function clearGeometry(group: THREE.Group) {
  group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  group.clear();
}

export default function PremiumBoard3D({ onBack }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const position = useRef<Chess | null>(null);
  const positionHistory = useRef<string[]>([]);
  const engine = useRef<Engine | null>(null);
  const enginePromise = useRef<Promise<Engine> | null>(null);
  const selectRef = useRef<(square: Key) => void>(() => {});

  const { session, dispatchSession } = useGameSession({ state: 'LOBBY', clockMs: GAME_MS, incrementMs: 0, connectionStatus: 'LOCAL' });
  const [mode, setMode] = useState<GameMode>('human');
  const [viewColor, setViewColor] = useState<Color>('white');
  const [fastForward, setFastForward] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('hard');
  const [sideChoice, setSideChoice] = useState<SideChoice>('white');
  const [humanColor, setHumanColor] = useState<Color | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('off');
  const [engineError, setEngineError] = useState('');
  const [selected, setSelected] = useState<Key | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [showClock, setShowClock] = useState(getClockVisible);

  const phase = sessionUiPhase(session);
  const positionId = session.positionId;
  const fen = session.fen;
  const turn = session.sideToMove as Color;
  const moves = session.movesSan;
  const whiteClock = session.clocks.whiteMs / 1000;
  const blackClock = session.clocks.blackMs / 1000;
  const strategyTime = session.countdownMs / 1000;
  const result = session.result;
  const pendingSlap = session.pendingClockPress as Color | null;
  const activeColor = clockOwner(session) as Color | null;
  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  useEffect(() => subscribeClockVisible(setShowClock), []);
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);
  const humanCanMove = useCallback((pos: Chess) => canColorMove(session, pos.turn) && (mode === 'human' || humanColor === pos.turn), [humanColor, mode, session]);

  const ensureEngine = useCallback(async () => {
    if (engine.current) return engine.current;
    if (!enginePromise.current) enginePromise.current = import('../engine/stockfish').then(({ StockfishEngine }) => (engine.current = new StockfishEngine() as Engine));
    return enginePromise.current;
  }, []);

  const sync3D = useCallback(() => {
    const h = sceneRef.current, pos = position.current;
    if (!h || !fen) return;
    h.board.rotation.y = viewColor === 'black' ? Math.PI : 0;
    clearGeometry(h.pieces); clearGeometry(h.selection);
    const white = h.scene.userData.white as THREE.Material;
    const black = h.scene.userData.black as THREE.Material;
    const selectedMat = h.scene.userData.selected as THREE.Material;
    const legalMat = h.scene.userData.legal as THREE.Material;
    for (const item of boardPieces(fen)) {
      const obj = piece(item.role, item.color === 'white' ? white : black);
      const p = squarePos(item.square); obj.position.set(p.x, .12, p.z); if (item.color === 'black') obj.rotation.y = Math.PI; h.pieces.add(obj);
    }
    if (selected && pos) {
      const p = squarePos(selected); const hi = mesh(new THREE.RingGeometry(.28, .39, 28), selectedMat, .115); hi.rotation.x = -Math.PI / 2; hi.position.set(p.x, .115, p.z); h.selection.add(hi);
      const destMap = chessgroundDests(pos, { chess960: true }) as unknown as Map<string, string[]>;
      for (const dest of destMap.get(selected) ?? []) { const d = squarePos(dest as Key); const dot = mesh(new THREE.CircleGeometry(.105, 20), legalMat, .122); dot.rotation.x = -Math.PI / 2; dot.position.set(d.x, .122, d.z); h.selection.add(dot); }
    }
    h.renderer.render(h.scene, h.camera);
  }, [fen, selected, viewColor]);

  const createPosition = useCallback(() => {
    const id = randomChess960Id();
    const pos = Chess.fromSetup(parseFen(chess960Fen(id)).unwrap()).unwrap();
    const chosen = mode === 'ai' ? chooseColor(sideChoice) : null;
    position.current = pos; positionHistory.current = [chessPositionKey(pos)]; setViewColor(chosen ?? 'white'); setHumanColor(chosen);
    dispatchSession({ type: 'RESET', options: { state: 'COUNTDOWN', positionId: id, fen: makeFen(pos.toSetup()), sideToMove: 'white', clockMs: GAME_MS, incrementMs: 0, countdownMs: STRATEGY_MS, connectionStatus: 'LOCAL' } });
    setFastForward(false); setSelected(null); setPromotion(null); setEngineError('');
  }, [dispatchSession, mode, sideChoice]);

  const finishMove = useCallback((move: Move) => {
    const pos = position.current;
    if (!pos || !canColorMove(session, pos.turn) || !pos.isLegal(move)) return false;
    const movingColor = pos.turn; const san = makeSan(pos, move); const capture = san.includes('x'); pos.play(move);
    positionHistory.current = appendPositionHistory(positionHistory.current, pos);
    playChessSound(capture ? 'capture' : 'move');
    dispatchSession({ type: 'MOVE_COMMITTED', fen: makeFen(pos.toSetup()), sideToMove: pos.turn, mover: movingColor, san, check: pos.isCheck(), checkmate: pos.isCheckmate() });
    setSelected(null);
    const end = resultOf(pos, positionHistory.current);
    if (end) { dispatchSession({ type: 'FINISH', ...end }); playChessSound('win'); engine.current?.cancelSearch(); }
    return true;
  }, [dispatchSession, session]);

  const moveSquare = useCallback((orig: Key, dest: Key) => {
    const pos = position.current; if (!pos || !humanCanMove(pos)) return;
    const sq = parseSquare(orig), pc = sq === undefined ? undefined : pos.board.get(sq);
    if (pc?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) { setPromotion({ orig, dest }); return; }
    const move = parseUci(`${orig}${dest}`); if (move) finishMove(move);
  }, [finishMove, humanCanMove]);

  const chooseSquare = useCallback((square: Key) => {
    const pos = position.current; if (!pos || !humanCanMove(pos)) return;
    const sq = parseSquare(square), pc = sq === undefined ? undefined : pos.board.get(sq);
    if (selected) {
      const dests = (chessgroundDests(pos, { chess960: true }) as unknown as Map<string, string[]>).get(selected) ?? [];
      if (dests.includes(square)) { moveSquare(selected, square); return; }
      if (pc?.color === pos.turn) { setSelected(square); return; }
      setSelected(null); return;
    }
    if (pc?.color === pos.turn) setSelected(square);
  }, [humanCanMove, moveSquare, selected]);
  selectRef.current = chooseSquare;

  const promote = (role: PromotionRole) => {
    if (!promotion) return;
    const suffix = role === 'queen' ? 'q' : role === 'rook' ? 'r' : role === 'bishop' ? 'b' : 'n';
    const move = parseUci(`${promotion.orig}${promotion.dest}${suffix}`); setPromotion(null); if (move) finishMove(move);
  };

  const resetCamera = useCallback(() => {
    const h = sceneRef.current; if (!h) return;
    h.camera.position.set(0, 17.4, 20.6); h.controls.target.set(0, .35, .95); h.controls.update(); h.renderer.render(h.scene, h.camera);
  }, []);

  useEffect(() => {
    const element = mount.current; if (!element) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x4b3a2d); scene.fog = new THREE.Fog(0x4b3a2d, 29, 48);
    const camera = new THREE.PerspectiveCamera(30, 1, .1, 100); camera.position.set(0, 17.4, 20.6); camera.lookAt(0, .35, .95);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.28; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; element.replaceChildren(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = false; controls.enableZoom = true; controls.rotateSpeed = .48; controls.zoomSpeed = .7; controls.minDistance = 19; controls.maxDistance = 32; controls.minPolarAngle = .54; controls.maxPolarAngle = 1.04; controls.minAzimuthAngle = -.82; controls.maxAzimuthAngle = .82; controls.target.set(0, .35, .95); controls.update(); controls.addEventListener('change', () => renderer.render(scene, camera));

    const shell = new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: .64, metalness: .08 });
    const inset = new THREE.MeshStandardMaterial({ color: 0x6b452c, roughness: .72, metalness: .04 });
    const lightSq = new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: .76, metalness: .02 });
    const darkSq = new THREE.MeshStandardMaterial({ color: 0x6f452a, roughness: .80, metalness: .02 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2eee5, roughness: .34, metalness: .06, clearcoat: .22, clearcoatRoughness: .42 });
    const black = new THREE.MeshPhysicalMaterial({ color: 0x171513, roughness: .30, metalness: .10, clearcoat: .18, clearcoatRoughness: .40 });
    const selectedMat = new THREE.MeshStandardMaterial({ color: 0x6adbb1, emissive: 0x173d31, side: THREE.DoubleSide, transparent: true, opacity: .92 });
    const legalMat = new THREE.MeshStandardMaterial({ color: 0x58d38f, emissive: 0x143b2a, side: THREE.DoubleSide, transparent: true, opacity: .86 });
    scene.userData.white = white; scene.userData.black = black; scene.userData.selected = selectedMat; scene.userData.legal = legalMat;

    const board = new THREE.Group(), pieces = new THREE.Group(), selection = new THREE.Group(); scene.add(board); board.add(pieces, selection);
    board.add(mesh(new THREE.BoxGeometry(9.35, .48, 9.35), shell, -.24)); board.add(mesh(new THREE.BoxGeometry(8.75, .15, 8.75), inset, -.03));
    const squares: THREE.Mesh[] = [];
    for (let rank = 1; rank <= 8; rank++) for (let file = 0; file < 8; file++) {
      const square = `${String.fromCharCode(97 + file)}${rank}` as Key, p = squarePos(square);
      const tile = mesh(new THREE.BoxGeometry(1, .08, 1), (file + rank) % 2 === 0 ? darkSq : lightSq, .04); tile.position.set(p.x, .04, p.z); tile.userData.square = square; squares.push(tile); board.add(tile);
    }
    scene.add(mesh(new THREE.CylinderGeometry(12.2, 12.7, .14, 64), new THREE.MeshStandardMaterial({ color: 0x31251d, roughness: .94 }), -.47));

    scene.add(new THREE.AmbientLight(0xfff4e8, .62)); scene.add(new THREE.HemisphereLight(0xfff7ed, 0x6f5847, 2.15));
    const fill = new THREE.DirectionalLight(0xffe6cf, 1.15); fill.position.set(-7, 9, 5); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xdcecff, .82); rim.position.set(7, 6, -8); scene.add(rim);
    const key = new THREE.DirectionalLight(0xffffff, 3.4); key.position.set(5.5, 11, 8.5); key.castShadow = true; key.shadow.mapSize.set(1536, 1536); key.shadow.camera.near = .1; key.shadow.camera.far = 38; key.shadow.camera.left = -9; key.shadow.camera.right = 9; key.shadow.camera.top = 9; key.shadow.camera.bottom = -9; key.shadow.bias = -.00006; key.shadow.normalBias = .014; scene.add(key, key.target); key.target.position.set(0, .25, 1.2);

    const ray = new THREE.Raycaster(); let down: Key | null = null, moved = false, sx = 0, sy = 0;
    const aim = (e: PointerEvent) => { const r = renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), camera); };
    const pickSquare = (e: PointerEvent): Key | null => { aim(e); return (ray.intersectObjects(squares, false)[0]?.object.userData.square as Key | undefined) ?? null; };
    const pd = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; moved = false; down = pickSquare(e); };
    const pm = (e: PointerEvent) => { if (Math.abs(e.clientX - sx) > 7 || Math.abs(e.clientY - sy) > 7) moved = true; };
    const pu = (e: PointerEvent) => { if (moved) return; const up = pickSquare(e); if (down && up && down === up) selectRef.current(up); };
    renderer.domElement.addEventListener('pointerdown', pd); renderer.domElement.addEventListener('pointermove', pm); renderer.domElement.addEventListener('pointerup', pu); renderer.domElement.addEventListener('pointercancel', pu);

    const resize = () => { const r = element.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.render(scene, camera); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); sceneRef.current = { scene, camera, renderer, controls, board, pieces, selection, squares };
    return () => { observer.disconnect(); renderer.domElement.removeEventListener('pointerdown', pd); renderer.domElement.removeEventListener('pointermove', pm); renderer.domElement.removeEventListener('pointerup', pu); renderer.domElement.removeEventListener('pointercancel', pu); controls.dispose(); renderer.dispose(); const mats = new Set<THREE.Material>(); scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => mats.add(x)); } }); mats.forEach(x => x.dispose()); sceneRef.current = null; element.replaceChildren(); };
  }, []);

  useEffect(() => { sync3D(); }, [sync3D]);
  useEffect(() => { if (mode !== 'ai' || positionId === null) { setEngineStatus('off'); return; } let cancelled = false; setEngineStatus('loading'); void ensureEngine().then(e => e.init()).then(() => { if (!cancelled) setEngineStatus('ready'); }).catch(err => { if (!cancelled) { setEngineStatus('error'); setEngineError(err instanceof Error ? err.message : 'Stockfish failed to load.'); } }); return () => { cancelled = true; }; }, [ensureEngine, mode, positionId]);
  useEffect(() => { if (session.state !== 'COUNTDOWN') return; if (session.countdownMs <= 0) { setFastForward(false); dispatchSession({ type: 'TRANSITION', to: 'ACTIVE' }); return; } const timer = window.setTimeout(() => dispatchSession({ type: 'COUNTDOWN_TICK', elapsedMs: 1000 }), fastForward ? 250 : 1000); return () => window.clearTimeout(timer); }, [dispatchSession, fastForward, session.countdownMs, session.state]);
  useEffect(() => { if (session.state !== 'ACTIVE') return; const timer = window.setInterval(() => { const owner = clockOwner(session); if (!owner) return; if (mode === 'ai' && owner === aiColor && engineStatus === 'loading') return; dispatchSession({ type: 'CLOCK_TICK', elapsedMs: 1000 }); }, 1000); return () => window.clearInterval(timer); }, [aiColor, dispatchSession, engineStatus, mode, session]);
  useEffect(() => { const pos = position.current; if (session.state !== 'ACTIVE' || mode !== 'ai' || !aiColor || !pos || session.pendingClockPress || session.sideToMove !== aiColor || session.result) return; let cancelled = false; const snapshot = session.fen; void (async () => { try { const e = await ensureEngine(); if (!e.isReady()) { setEngineStatus('loading'); await e.init(); } if (cancelled) return; setEngineStatus('thinking'); const uci = await e.bestMove(snapshot, difficulty), current = position.current; if (cancelled || !current || current.turn !== aiColor || makeFen(current.toSetup()) !== snapshot) return; const move = parseUci(uci); if (!move || !current.isLegal(move)) throw new Error('Stockfish returned an invalid move.'); finishMove(move); setEngineStatus('ready'); } catch (err) { if (!cancelled) { setEngineStatus('error'); setEngineError(err instanceof Error ? err.message : 'Stockfish could not move.'); } } })(); return () => { cancelled = true; engine.current?.cancelSearch(); }; }, [aiColor, difficulty, ensureEngine, finishMove, mode, session.fen, session.pendingClockPress, session.result, session.sideToMove, session.state]);
  useEffect(() => { if (session.state !== 'ACTIVE' || mode !== 'ai' || !aiColor || !session.pendingClockPress) return; const delay = session.pendingClockPress === aiColor ? 220 : 120; const timer = window.setTimeout(() => dispatchSession({ type: 'CLOCK_TRANSFERRED' }), delay); return () => window.clearTimeout(timer); }, [aiColor, dispatchSession, mode, session.pendingClockPress, session.state]);
  useEffect(() => () => engine.current?.destroy(), []);

  const startNow = () => { if (session.state === 'COUNTDOWN') { dispatchSession({ type: 'SET_COUNTDOWN', remainingMs: 0 }); dispatchSession({ type: 'TRANSITION', to: 'ACTIVE' }); setFastForward(false); playChessSound('start'); } };
  const slapClock = () => { if (!session.pendingClockPress || session.pendingClockPress === aiColor || session.state !== 'ACTIVE') return; dispatchSession({ type: 'CLOCK_TRANSFERRED' }); };
  const playerName = (color: Color) => mode === 'ai' && aiColor === color ? `Stockfish · ${DIFFICULTIES[difficulty].label}` : mode === 'ai' ? 'You' : color === 'white' ? 'White' : 'Black';

  return <div data-game-state={session.state} className={`premium-page-v14 qqurz-content-page three-play-page ${showClock ? 'clock-visible' : 'clock-hidden'}`}>
    <section className="page-heading-v14 compact"><button className="text-back" onClick={onBack}>← Home</button><span className="qqurz-kicker">PREMIUM 3D</span><h1>Real board. Real clock. Real slap.</h1><p>The same reference-matched 3D tournament clock sits directly below the walnut board in Human vs Human and AI play, with a live LCD, green turn LEDs and a real curved seesaw rocker.</p></section>
    <section className="three-setup-card">
      <div className="local-mode-switch"><button className={mode === 'human' ? 'selected' : ''} onClick={() => setMode('human')}>Human vs Human</button><button className={mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')}>Play AI</button></div>
      {mode === 'ai' && <div className="local-ai-options"><div><span>AI strength</span><div className="option-pills">{(Object.keys(DIFFICULTIES) as Difficulty[]).map(level => <button key={level} className={difficulty === level ? 'selected' : ''} onClick={() => setDifficulty(level)}><b>{DIFFICULTIES[level].label}</b><small>{DIFFICULTIES[level].note}</small></button>)}</div></div><div><span>Play as</span><div className="side-pills">{(['white', 'black', 'random'] as SideChoice[]).map(side => <button key={side} className={sideChoice === side ? 'selected' : ''} onClick={() => setSideChoice(side)}>{side[0].toUpperCase() + side.slice(1)}</button>)}</div></div></div>}
      <div className="three-toolbar-row"><button className="primary-black" onClick={createPosition}>{phase === 'setup' ? 'Create 3D Position' : 'New 3D Position'}</button><button className="secondary-clean" onClick={() => setViewColor(v => opposite(v))} disabled={positionId === null}>Flip board</button><button className="secondary-clean" onClick={resetCamera}>Reset camera</button><button className={`secondary-clean clock-visibility-toggle ${showClock ? 'on' : 'off'}`} onClick={() => setClockVisible(!showClock)} aria-pressed={showClock}>{showClock ? 'Clock on' : 'Clock off'}</button><span className="three-inline-note">Drag to rotate · pinch/scroll to zoom · green dots = legal moves</span></div>
    </section>
    <section className="three-play-grid"><div className="three-main-column"><section className="three-board-card high-fidelity walnut">
      <div ref={mount} className="three-board-mount" aria-label="Interactive 3D chess board"/><div className="three-preview-badge">PREMIUM 3D</div><div className="three-board-help">Tap piece, then destination</div>
      {phase === 'strategy' && <div className="local-board-overlay"><span>STRATEGY</span><strong>{fmt(strategyTime)}</strong><p>Study the Chess960 position. Green dots show legal destinations; red tactical danger warnings stay off.</p><div><button onPointerDown={() => setFastForward(true)} onPointerUp={() => setFastForward(false)} onPointerCancel={() => setFastForward(false)}>Hold ×4</button><button className="primary-black" onClick={startNow}>Start Now</button></div></div>}
      {phase === 'ended' && result && <div className="local-board-overlay ended"><span>GAME OVER</span><strong className="end-title">{result}</strong><button className="primary-black" onClick={createPosition}>New position</button></div>}
    </section><PhysicalChessClock whiteSeconds={whiteClock} blackSeconds={blackClock} activeColor={activeColor} pendingSlap={pendingSlap} disabled={!pendingSlap || pendingSlap === aiColor} onSlap={slapClock} compact visible={showClock} onVisibleChange={setClockVisible} className="premium-physical-clock" /></div><aside className="three-side-column"><div className="three-panel"><span className="qqurz-kicker">POSITION {positionId !== null ? `#${positionId}` : '—'}</span><h2>{backRank || 'Open a 3D position'}</h2><p>{mode === 'ai' ? `You vs ${DIFFICULTIES[difficulty].label} Stockfish` : 'Two players on one device'}</p></div>{phase === 'playing' && pendingSlap && pendingSlap !== aiColor && !showClock && <button className={`clock-slap-inline three-slap-fallback ${pendingSlap}`} onClick={slapClock}>END {pendingSlap.toUpperCase()} TURN</button>}{mode === 'ai' && <div className={`local-engine-state ${engineStatus}`}>{engineStatus === 'loading' ? 'Loading Stockfish…' : engineStatus === 'thinking' ? 'Stockfish thinking…' : engineStatus === 'ready' ? 'Stockfish ready' : engineError || 'AI preparing'}</div>}<div className="three-panel muted"><span className="qqurz-kicker">CLOCK MODEL</span><ul className="three-note-list"><li>132 × 114 × 36 mm reference-scale wedge housing.</li><li>True-depth curved rocker and housing; invisible underside detail is intentionally omitted for mobile FPS.</li><li>Green LEDs show which side is active or waiting to press.</li><li>The same reusable physical clock and authoritative game session are used in every QQURZ game mode.</li></ul></div><div className="three-panel moves"><span className="qqurz-kicker">MOVES</span>{moves.length ? <ol>{moves.map((move, i) => <li key={`${move}-${i}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}</div></aside></section>
    {promotion && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="promotion-modal"><span className="qqurz-kicker">PROMOTION</span><h2>Choose a piece</h2><div className="promotion-grid"><button onClick={() => promote('queen')}>♕ Queen</button><button onClick={() => promote('rook')}>♖ Rook</button><button onClick={() => promote('bishop')}>♗ Bishop</button><button onClick={() => promote('knight')}>♘ Knight</button></div></div></div>}
  </div>;
}
