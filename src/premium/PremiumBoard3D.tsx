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
import { playChessSound } from '../ui/sound';
import {
  animateChessClockRocker,
  createChessClockModel,
  disposeChessClockModel,
  updateChessClockModel,
  type ChessClockModel,
  type ClockSide,
} from './ChessClock3D';

type Props = { onBack: () => void };
type GameMode = 'human' | 'ai';
type Phase = 'setup' | 'strategy' | 'playing' | 'ended';
type Difficulty = 'easy' | 'hard' | 'crazy';
type SideChoice = 'white' | 'black' | 'random';
type PromotionRole = Extract<Role, 'queen' | 'rook' | 'bishop' | 'knight'>;
type EngineStatus = 'off' | 'loading' | 'ready' | 'thinking' | 'error';
type Engine = {
  init: () => Promise<void>;
  isReady: () => boolean;
  bestMove: (fen: string, difficulty: Difficulty) => Promise<string>;
  cancelSearch: () => void;
  destroy: () => void;
};
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
  clock: ChessClockModel;
};

const GAME_SECONDS = 600;
const STRATEGY_SECONDS = 120;
const DIFFICULTIES: Record<Difficulty, { label: string; note: string }> = {
  easy: { label: 'Easy', note: 'Relaxed and forgiving' },
  hard: { label: 'Hard', note: 'Strong club-level play' },
  crazy: { label: 'Crazy Hard', note: 'Full-power Stockfish' },
};

function fmt(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function opposite(color: Color): Color { return color === 'white' ? 'black' : 'white'; }
function chooseColor(choice: SideChoice): Color { return choice === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : choice; }

function resultOf(pos: Chess): string | null {
  if (pos.isCheckmate()) return pos.turn === 'white' ? 'Black wins by checkmate' : 'White wins by checkmate';
  if (pos.isStalemate()) return 'Draw by stalemate';
  if (pos.isInsufficientMaterial()) return 'Draw by insufficient material';
  return pos.isEnd() ? 'Game over' : null;
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
      out.push({
        square: `${String.fromCharCode(97 + file)}${8 - rowIndex}` as Key,
        color: char === char.toUpperCase() ? 'white' : 'black',
        role,
      });
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
  const seg = 32;
  group.add(mesh(new THREE.CylinderGeometry(compact ? 0.31 : 0.35, compact ? 0.38 : 0.42, 0.09, seg), material, 0.045));
  group.add(mesh(new THREE.CylinderGeometry(compact ? 0.27 : 0.30, compact ? 0.33 : 0.36, 0.07, seg), material, 0.125));
  const torus = mesh(new THREE.TorusGeometry(compact ? 0.245 : 0.26, 0.028, 14, 32), material, 0.205);
  torus.rotation.x = Math.PI / 2;
  group.add(torus);
}

function piece(role: Role, material: THREE.Material) {
  const group = new THREE.Group();
  const seg = 30;
  addBase(group, material, role === 'pawn');
  if (role === 'pawn') {
    group.add(mesh(new THREE.CylinderGeometry(0.135, 0.22, 0.37, seg), material, 0.42));
    const collar = mesh(new THREE.TorusGeometry(0.17, 0.026, 12, 28), material, 0.64);
    collar.rotation.x = Math.PI / 2;
    group.add(collar);
    group.add(mesh(new THREE.SphereGeometry(0.18, 28, 20), material, 0.79));
  } else if (role === 'rook') {
    group.add(mesh(new THREE.CylinderGeometry(0.20, 0.245, 0.54, seg), material, 0.48));
    group.add(mesh(new THREE.CylinderGeometry(0.30, 0.23, 0.12, seg), material, 0.81));
    for (let i = 0; i < 4; i += 1) {
      const crown = mesh(new THREE.BoxGeometry(0.10, 0.12, 0.17), material, 0.95);
      const angle = i * Math.PI / 2;
      crown.position.x = Math.cos(angle) * 0.2;
      crown.position.z = Math.sin(angle) * 0.2;
      group.add(crown);
    }
  } else if (role === 'knight') {
    group.add(mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.31, seg), material, 0.36));
    const neck = mesh(new THREE.CapsuleGeometry(0.15, 0.39, 7, 16), material, 0.67);
    neck.rotation.z = -0.38;
    neck.position.x = 0.08;
    group.add(neck);
    const head = mesh(new THREE.BoxGeometry(0.27, 0.25, 0.21), material, 0.95);
    head.rotation.z = -0.24;
    head.position.x = 0.2;
    group.add(head);
    const ear = mesh(new THREE.ConeGeometry(0.06, 0.14, 12), material, 1.10);
    ear.position.x = 0.14;
    group.add(ear);
  } else if (role === 'bishop') {
    group.add(mesh(new THREE.CylinderGeometry(0.15, 0.22, 0.57, seg), material, 0.48));
    group.add(mesh(new THREE.SphereGeometry(0.155, 24, 18), material, 0.87));
    const slit = mesh(new THREE.BoxGeometry(0.038, 0.22, 0.20), material, 0.95);
    slit.rotation.z = 0.65;
    group.add(slit);
    group.add(mesh(new THREE.SphereGeometry(0.06, 18, 12), material, 1.09));
  } else if (role === 'queen') {
    group.add(mesh(new THREE.CylinderGeometry(0.16, 0.23, 0.66, seg), material, 0.50));
    group.add(mesh(new THREE.CylinderGeometry(0.27, 0.17, 0.15, seg), material, 0.91));
    for (let i = 0; i < 6; i += 1) {
      const jewel = mesh(new THREE.SphereGeometry(0.052, 16, 12), material, 1.07);
      const angle = i * Math.PI / 3;
      jewel.position.x = Math.cos(angle) * 0.13;
      jewel.position.z = Math.sin(angle) * 0.13;
      group.add(jewel);
    }
    group.add(mesh(new THREE.SphereGeometry(0.08, 20, 14), material, 1.10));
  } else {
    group.add(mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.69, seg), material, 0.51));
    group.add(mesh(new THREE.SphereGeometry(0.15, 24, 18), material, 0.95));
    group.add(mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), material, 1.18));
    group.add(mesh(new THREE.BoxGeometry(0.24, 0.06, 0.08), material, 1.18));
  }
  return group;
}

function clearGeometry(group: THREE.Group) {
  group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  group.clear();
}

export default function PremiumBoard3D({ onBack }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const position = useRef<Chess | null>(null);
  const engine = useRef<Engine | null>(null);
  const enginePromise = useRef<Promise<Engine> | null>(null);
  const selectRef = useRef<(square: Key) => void>(() => {});
  const clockSlapRef = useRef<(side?: ClockSide) => void>(() => {});

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
  const [selected, setSelected] = useState<Key | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);
  const [pendingSlap, setPendingSlap] = useState<Color | null>(null);

  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);

  const ensureEngine = useCallback(async () => {
    if (engine.current) return engine.current;
    if (!enginePromise.current) {
      enginePromise.current = import('../engine/stockfish').then(({ StockfishEngine }) => (engine.current = new StockfishEngine() as Engine));
    }
    return enginePromise.current;
  }, []);

  const humanCanMove = useCallback((pos: Chess) => {
    return phase === 'playing' && !pendingSlap && (mode === 'human' || humanColor === pos.turn);
  }, [humanColor, mode, pendingSlap, phase]);

  const renderScene = useCallback(() => {
    const handle = sceneRef.current;
    if (handle) handle.renderer.render(handle.scene, handle.camera);
  }, []);

  const animateRocker = useCallback((side: Color) => {
    const handle = sceneRef.current;
    if (!handle) return;
    animateChessClockRocker(handle.clock, side, () => handle.renderer.render(handle.scene, handle.camera));
  }, []);

  const sync3D = useCallback(() => {
    const handle = sceneRef.current;
    const pos = position.current;
    if (!handle || !fen) return;
    handle.board.rotation.y = viewColor === 'black' ? Math.PI : 0;
    clearGeometry(handle.pieces);
    clearGeometry(handle.selection);
    const white = handle.scene.userData.white as THREE.Material;
    const black = handle.scene.userData.black as THREE.Material;
    const selectedMat = handle.scene.userData.selected as THREE.Material;
    const legalMat = handle.scene.userData.legal as THREE.Material;
    for (const item of boardPieces(fen)) {
      const object = piece(item.role, item.color === 'white' ? white : black);
      const point = squarePos(item.square);
      object.position.set(point.x, 0.12, point.z);
      if (item.color === 'black') object.rotation.y = Math.PI;
      handle.pieces.add(object);
    }
    if (selected && pos) {
      const point = squarePos(selected);
      const highlight = mesh(new THREE.RingGeometry(0.28, 0.39, 32), selectedMat, 0.115);
      highlight.rotation.x = -Math.PI / 2;
      highlight.position.set(point.x, 0.115, point.z);
      handle.selection.add(highlight);
      const destMap = chessgroundDests(pos, { chess960: true }) as unknown as Map<string, string[]>;
      for (const dest of destMap.get(selected) ?? []) {
        const destination = squarePos(dest as Key);
        const dot = mesh(new THREE.CircleGeometry(0.105, 24), legalMat, 0.122);
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(destination.x, 0.122, destination.z);
        handle.selection.add(dot);
      }
    }
    handle.renderer.render(handle.scene, handle.camera);
  }, [fen, selected, viewColor]);

  const createPosition = useCallback(() => {
    const id = randomChess960Id();
    const pos = Chess.fromSetup(parseFen(chess960Fen(id)).unwrap()).unwrap();
    const chosen = mode === 'ai' ? chooseColor(sideChoice) : null;
    position.current = pos;
    setPositionId(id);
    setFen(makeFen(pos.toSetup()));
    setTurn('white');
    setViewColor(chosen ?? 'white');
    setHumanColor(chosen);
    setMoves([]);
    setWhiteClock(GAME_SECONDS);
    setBlackClock(GAME_SECONDS);
    setStrategyTime(STRATEGY_SECONDS);
    setFastForward(false);
    setResult(null);
    setSelected(null);
    setPromotion(null);
    setPendingSlap(null);
    setEngineError('');
    setPhase('strategy');
  }, [mode, sideChoice]);

  const finishMove = useCallback((move: Move) => {
    const pos = position.current;
    if (!pos || phase !== 'playing' || pendingSlap || !pos.isLegal(move)) return false;
    const movingColor = pos.turn;
    const san = makeSan(pos, move);
    const capture = san.includes('x');
    pos.play(move);
    playChessSound(capture ? 'capture' : 'move');
    setFen(makeFen(pos.toSetup()));
    setTurn(pos.turn);
    setMoves(values => [...values, san]);
    setSelected(null);
    const end = resultOf(pos);
    if (end) {
      setResult(end);
      setPhase('ended');
      setPendingSlap(null);
      playChessSound('win');
      engine.current?.cancelSearch();
    } else {
      setPendingSlap(movingColor);
    }
    return true;
  }, [pendingSlap, phase]);

  const moveSquare = useCallback((orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || !humanCanMove(pos)) return;
    const square = parseSquare(orig);
    const selectedPiece = square === undefined ? undefined : pos.board.get(square);
    if (selectedPiece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) {
      setPromotion({ orig, dest });
      return;
    }
    const move = parseUci(`${orig}${dest}`);
    if (move) finishMove(move);
  }, [finishMove, humanCanMove]);

  const chooseSquare = useCallback((square: Key) => {
    const pos = position.current;
    if (!pos || !humanCanMove(pos)) return;
    const index = parseSquare(square);
    const selectedPiece = index === undefined ? undefined : pos.board.get(index);
    if (selected) {
      const destMap = chessgroundDests(pos, { chess960: true }) as unknown as Map<string, string[]>;
      const legal = destMap.get(selected) ?? [];
      if (legal.includes(square)) {
        moveSquare(selected, square);
        return;
      }
      if (selectedPiece?.color === pos.turn) {
        setSelected(square);
        return;
      }
      setSelected(null);
      return;
    }
    if (selectedPiece?.color === pos.turn) setSelected(square);
  }, [humanCanMove, moveSquare, selected]);
  selectRef.current = chooseSquare;

  const promote = (role: PromotionRole) => {
    if (!promotion) return;
    const suffix = role === 'queen' ? 'q' : role === 'rook' ? 'r' : role === 'bishop' ? 'b' : 'n';
    const move = parseUci(`${promotion.orig}${promotion.dest}${suffix}`);
    setPromotion(null);
    if (move) finishMove(move);
  };

  const resetCamera = useCallback(() => {
    const handle = sceneRef.current;
    if (!handle) return;
    handle.camera.position.set(0.2, 15.8, 15.2);
    handle.controls.target.set(-0.45, 0.45, 0.1);
    handle.controls.update();
    handle.renderer.render(handle.scene, handle.camera);
  }, []);

  const slapClock = useCallback((side?: ClockSide) => {
    if (!pendingSlap || pendingSlap === aiColor || phase !== 'playing') return;
    if (side && side !== pendingSlap) {
      playChessSound('error');
      return;
    }
    animateRocker(pendingSlap);
    playChessSound('slap');
    setPendingSlap(null);
  }, [aiColor, animateRocker, pendingSlap, phase]);
  clockSlapRef.current = slapClock;

  useEffect(() => {
    const element = mount.current;
    if (!element) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x4b3a2d);
    scene.fog = new THREE.Fog(0x4b3a2d, 26, 44);

    const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 100);
    camera.position.set(0.2, 15.8, 15.2);
    camera.lookAt(-0.45, 0.45, 0.1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    element.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.72;
    controls.minDistance = 16;
    controls.maxDistance = 24;
    controls.minPolarAngle = 0.58;
    controls.maxPolarAngle = 1.02;
    controls.minAzimuthAngle = -0.92;
    controls.maxAzimuthAngle = 0.92;
    controls.target.set(-0.45, 0.45, 0.1);
    controls.update();
    controls.addEventListener('change', renderScene);

    const shell = new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.64, metalness: 0.08 });
    const inset = new THREE.MeshStandardMaterial({ color: 0x6b452c, roughness: 0.72, metalness: 0.04 });
    const lightSq = new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.76, metalness: 0.02 });
    const darkSq = new THREE.MeshStandardMaterial({ color: 0x6f452a, roughness: 0.80, metalness: 0.02 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2eee5, roughness: 0.34, metalness: 0.06, clearcoat: 0.22, clearcoatRoughness: 0.42 });
    const black = new THREE.MeshPhysicalMaterial({ color: 0x171513, roughness: 0.30, metalness: 0.10, clearcoat: 0.18, clearcoatRoughness: 0.40 });
    const selectedMat = new THREE.MeshStandardMaterial({ color: 0x6adbb1, emissive: 0x173d31, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    const legalMat = new THREE.MeshStandardMaterial({ color: 0x58d38f, emissive: 0x143b2a, side: THREE.DoubleSide, transparent: true, opacity: 0.86 });
    scene.userData.white = white;
    scene.userData.black = black;
    scene.userData.selected = selectedMat;
    scene.userData.legal = legalMat;

    const board = new THREE.Group();
    const pieces = new THREE.Group();
    const selection = new THREE.Group();
    board.position.x = 0.85;
    scene.add(board);
    board.add(pieces, selection);
    board.add(mesh(new THREE.BoxGeometry(9.35, 0.48, 9.35), shell, -0.24));
    board.add(mesh(new THREE.BoxGeometry(8.75, 0.15, 8.75), inset, -0.03));

    const squares: THREE.Mesh[] = [];
    for (let rank = 1; rank <= 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        const square = `${String.fromCharCode(97 + file)}${rank}` as Key;
        const point = squarePos(square);
        const tile = mesh(new THREE.BoxGeometry(1, 0.08, 1), (file + rank) % 2 === 0 ? darkSq : lightSq, 0.04);
        tile.position.set(point.x, 0.04, point.z);
        tile.userData.square = square;
        squares.push(tile);
        board.add(tile);
      }
    }

    const clock = createChessClockModel();
    clock.group.scale.setScalar(0.78);
    clock.group.position.set(-5.72, -0.39, 0.95);
    clock.group.rotation.y = 0.03;
    scene.add(clock.group);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x31251d, roughness: 0.94 });
    scene.add(mesh(new THREE.CylinderGeometry(11.8, 12.2, 0.14, 56), floorMat, -0.47));

    scene.add(new THREE.AmbientLight(0xfff4e8, 0.62));
    scene.add(new THREE.HemisphereLight(0xfff7ed, 0x6f5847, 2.15));
    const fill = new THREE.DirectionalLight(0xffe6cf, 1.15);
    fill.position.set(-7, 9, 5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xdcecff, 0.82);
    rim.position.set(7, 6, -8);
    scene.add(rim);
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(5.5, 11, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 34;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.00006;
    key.shadow.normalBias = 0.014;
    scene.add(key, key.target);
    key.target.position.set(-0.3, 0.25, 0);

    const ray = new THREE.Raycaster();
    let downSquare: Key | null = null;
    let downClock: ClockSide | null = null;
    let moved = false;
    let sx = 0;
    let sy = 0;

    const setRay = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      ), camera);
    };

    const pickSquare = (event: PointerEvent): Key | null => {
      setRay(event);
      return (ray.intersectObjects(squares, false)[0]?.object.userData.square as Key | undefined) ?? null;
    };

    const pickClock = (event: PointerEvent): ClockSide | null => {
      setRay(event);
      return (ray.intersectObjects(clock.hitMeshes, false)[0]?.object.userData.clockSide as ClockSide | undefined) ?? null;
    };

    const pointerDown = (event: PointerEvent) => {
      sx = event.clientX;
      sy = event.clientY;
      moved = false;
      downClock = pickClock(event);
      downSquare = downClock ? null : pickSquare(event);
    };
    const pointerMove = (event: PointerEvent) => {
      if (Math.abs(event.clientX - sx) > 7 || Math.abs(event.clientY - sy) > 7) moved = true;
    };
    const pointerUp = (event: PointerEvent) => {
      if (moved) return;
      const clockSide = pickClock(event);
      if (downClock && clockSide && downClock === clockSide) {
        clockSlapRef.current(clockSide);
        return;
      }
      const up = pickSquare(event);
      if (downSquare && up && downSquare === up) selectRef.current(up);
    };

    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);

    const resize = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    sceneRef.current = { scene, camera, renderer, controls, board, pieces, selection, squares, clock };
    resize();

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      controls.removeEventListener('change', renderScene);
      controls.dispose();
      scene.remove(clock.group);
      disposeChessClockModel(clock);
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(material => materials.add(material));
      });
      materials.forEach(material => material.dispose());
      renderer.dispose();
      sceneRef.current = null;
      element.replaceChildren();
    };
  }, [renderScene]);

  useEffect(() => { sync3D(); }, [sync3D]);

  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle) return;
    updateChessClockModel(handle.clock, whiteClock, blackClock, phase === 'playing' ? pendingSlap : null, phase);
    handle.renderer.render(handle.scene, handle.camera);
  }, [blackClock, pendingSlap, phase, whiteClock]);

  useEffect(() => {
    if (mode !== 'ai' || positionId === null) {
      setEngineStatus('off');
      return;
    }
    let cancelled = false;
    setEngineStatus('loading');
    void ensureEngine().then(value => value.init()).then(() => {
      if (!cancelled) setEngineStatus('ready');
    }).catch(error => {
      if (!cancelled) {
        setEngineStatus('error');
        setEngineError(error instanceof Error ? error.message : 'Stockfish failed to load.');
      }
    });
    return () => { cancelled = true; };
  }, [ensureEngine, mode, positionId]);

  useEffect(() => {
    if (phase !== 'strategy') return;
    if (strategyTime <= 0) {
      setFastForward(false);
      setPhase('playing');
      return;
    }
    const timer = window.setTimeout(() => setStrategyTime(value => Math.max(0, value - 1)), fastForward ? 250 : 1000);
    return () => window.clearTimeout(timer);
  }, [fastForward, phase, strategyTime]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      const pos = position.current;
      if (!pos) return;
      const owner = pendingSlap ?? pos.turn;
      if (mode === 'ai' && owner === aiColor && engineStatus === 'loading') return;
      const setter = owner === 'white' ? setWhiteClock : setBlackClock;
      setter(value => {
        const next = Math.max(0, value - 1);
        if (next === 0) {
          setResult(owner === 'white' ? 'Black wins on time' : 'White wins on time');
          setPhase('ended');
          setPendingSlap(null);
          playChessSound('win');
          engine.current?.cancelSearch();
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [aiColor, engineStatus, mode, pendingSlap, phase]);

  useEffect(() => {
    const pos = position.current;
    if (phase !== 'playing' || mode !== 'ai' || !aiColor || !pos || pendingSlap || pos.turn !== aiColor || result) return;
    let cancelled = false;
    const snapshot = makeFen(pos.toSetup());
    void (async () => {
      try {
        const value = await ensureEngine();
        if (!value.isReady()) { setEngineStatus('loading'); await value.init(); }
        if (cancelled) return;
        setEngineStatus('thinking');
        const uci = await value.bestMove(snapshot, difficulty);
        const current = position.current;
        if (cancelled || !current || current.turn !== aiColor || makeFen(current.toSetup()) !== snapshot) return;
        const move = parseUci(uci);
        if (!move || !current.isLegal(move)) throw new Error('Stockfish returned an invalid move.');
        finishMove(move);
        setEngineStatus('ready');
      } catch (error) {
        if (!cancelled) {
          setEngineStatus('error');
          setEngineError(error instanceof Error ? error.message : 'Stockfish could not move.');
        }
      }
    })();
    return () => { cancelled = true; engine.current?.cancelSearch(); };
  }, [aiColor, difficulty, ensureEngine, fen, finishMove, mode, pendingSlap, phase, result, turn]);

  useEffect(() => {
    if (phase !== 'playing' || mode !== 'ai' || !aiColor || pendingSlap !== aiColor) return;
    const timer = window.setTimeout(() => {
      animateRocker(aiColor);
      playChessSound('slap');
      setPendingSlap(null);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [aiColor, animateRocker, mode, pendingSlap, phase]);

  useEffect(() => () => engine.current?.destroy(), []);

  const startNow = () => {
    if (phase !== 'strategy') return;
    setStrategyTime(0);
    setFastForward(false);
    setPhase('playing');
    playChessSound('start');
  };

  const playerName = (color: Color) => mode === 'ai' && aiColor === color
    ? `Stockfish · ${DIFFICULTIES[difficulty].label}`
    : mode === 'ai' ? 'You' : color === 'white' ? 'White' : 'Black';

  return (
    <div className="premium-page-v14 qqurz-content-page three-play-page">
      <section className="page-heading-v14 compact">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">PREMIUM 3D</span>
        <h1>Real board. Real clock. Tap the rocker.</h1>
        <p>The reference-matched QQURZ tournament clock now sits beside the board, shows the live game timers, and its white rocker is the actual clock control.</p>
      </section>

      <section className="three-setup-card">
        <div className="local-mode-switch">
          <button className={mode === 'human' ? 'selected' : ''} onClick={() => setMode('human')}>Human vs Human</button>
          <button className={mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')}>Play AI</button>
        </div>
        {mode === 'ai' && (
          <div className="local-ai-options">
            <div>
              <span>AI strength</span>
              <div className="option-pills">
                {(Object.keys(DIFFICULTIES) as Difficulty[]).map(level => (
                  <button key={level} className={difficulty === level ? 'selected' : ''} onClick={() => setDifficulty(level)}>
                    <b>{DIFFICULTIES[level].label}</b><small>{DIFFICULTIES[level].note}</small>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span>Play as</span>
              <div className="side-pills">
                {(['white', 'black', 'random'] as SideChoice[]).map(side => (
                  <button key={side} className={sideChoice === side ? 'selected' : ''} onClick={() => setSideChoice(side)}>{side[0].toUpperCase() + side.slice(1)}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="three-toolbar-row">
          <button className="primary-black" onClick={createPosition}>{phase === 'setup' ? 'Create 3D Position' : 'New 3D Position'}</button>
          <button className="secondary-clean" onClick={() => setViewColor(value => opposite(value))} disabled={positionId === null}>Flip board</button>
          <button className="secondary-clean" onClick={resetCamera}>Reset camera</button>
          <span className="three-inline-note">Tap rocker to pass the turn · drag to rotate · pinch/scroll to zoom</span>
        </div>
      </section>

      <section className="three-play-grid">
        <div className="three-main-column">
          <section className="three-board-card high-fidelity walnut with-physical-clock">
            <div ref={mount} className="three-board-mount" aria-label="Interactive 3D chess board with slappable tournament clock" />
            <div className="three-preview-badge">PREMIUM 3D · LIVE CLOCK</div>
            <div className="three-board-help">Move piece → tap matching side of white rocker</div>
            {phase === 'strategy' && (
              <div className="local-board-overlay">
                <span>STRATEGY</span>
                <strong>{fmt(strategyTime)}</strong>
                <p>Study the Chess960 position. Green dots show legal destinations; red tactical danger warnings stay off.</p>
                <div>
                  <button onPointerDown={() => setFastForward(true)} onPointerUp={() => setFastForward(false)} onPointerCancel={() => setFastForward(false)}>Hold ×4</button>
                  <button className="primary-black" onClick={startNow}>Start Now</button>
                </div>
              </div>
            )}
            {phase === 'ended' && result && (
              <div className="local-board-overlay ended"><span>GAME OVER</span><strong className="end-title">{result}</strong><button className="primary-black" onClick={createPosition}>New position</button></div>
            )}
          </section>
        </div>

        <aside className="three-side-column">
          <div className="three-panel">
            <span className="qqurz-kicker">POSITION {positionId !== null ? `#${positionId}` : '—'}</span>
            <h2>{backRank || 'Open a 3D position'}</h2>
            <p>{mode === 'ai' ? `You vs ${DIFFICULTIES[difficulty].label} Stockfish` : 'Two players on one device'}</p>
          </div>
          <div className="three-clocks">
            <div className={(pendingSlap ?? turn) === 'black' && phase === 'playing' ? 'active' : ''}><span>{playerName('black')}</span><strong>{fmt(blackClock)}</strong></div>
            <div className={(pendingSlap ?? turn) === 'white' && phase === 'playing' ? 'active' : ''}><span>{playerName('white')}</span><strong>{fmt(whiteClock)}</strong></div>
          </div>
          {phase === 'playing' && pendingSlap && pendingSlap !== aiColor && (
            <button className={`clock-slap-inline three-slap ${pendingSlap}`} onClick={() => slapClock()}>
              SLAP {pendingSlap.toUpperCase()} CLOCK
            </button>
          )}
          {mode === 'ai' && <div className={`local-engine-state ${engineStatus}`}>{engineStatus === 'loading' ? 'Loading Stockfish…' : engineStatus === 'thinking' ? 'Stockfish thinking…' : engineStatus === 'ready' ? 'Stockfish ready' : engineError || 'AI preparing'}</div>}
          <div className="three-panel muted">
            <span className="qqurz-kicker">TOURNAMENT HARDWARE</span>
            <ul className="three-note-list">
              <li>Reference-matched black rounded clock body.</li>
              <li>Live two-sided LCD with seven-segment digits.</li>
              <li>Clickable white seesaw rocker with physical tilt.</li>
              <li>Four front controls, feet, bezel and battery-door detail.</li>
            </ul>
          </div>
          <div className="three-panel moves">
            <span className="qqurz-kicker">MOVES</span>
            {moves.length ? <ol>{moves.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}
          </div>
        </aside>
      </section>

      {promotion && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="promotion-modal">
            <span className="qqurz-kicker">PROMOTION</span>
            <h2>Choose a piece</h2>
            <div className="promotion-grid">
              <button onClick={() => promote('queen')}>♕ Queen</button>
              <button onClick={() => promote('rook')}>♖ Rook</button>
              <button onClick={() => promote('bishop')}>♗ Bishop</button>
              <button onClick={() => promote('knight')}>♘ Knight</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
