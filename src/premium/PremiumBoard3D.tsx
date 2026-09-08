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

type SceneHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  root: THREE.Group;
  boardRoot: THREE.Group;
  piecesGroup: THREE.Group;
  overlayGroup: THREE.Group;
  squareMeshes: THREE.Mesh[];
  raycaster: THREE.Raycaster;
};

type FenPiece = { square: Key; color: Color; role: Role };

type PieceTheme = {
  boardShell: THREE.MeshStandardMaterial;
  boardInset: THREE.MeshStandardMaterial;
  lightSquare: THREE.MeshStandardMaterial;
  darkSquare: THREE.MeshStandardMaterial;
  whitePiece: THREE.MeshStandardMaterial;
  blackPiece: THREE.MeshStandardMaterial;
  selected: THREE.MeshStandardMaterial;
  legal: THREE.MeshStandardMaterial;
};

const GAME_SECONDS = 10 * 60;
const STRATEGY_SECONDS = 120;
const FAST_FORWARD_RATE = 4;
const DIFFICULTIES: Record<Difficulty, { label: string; note: string }> = {
  easy: { label: 'Easy', note: 'Relaxed and forgiving' },
  hard: { label: 'Hard', note: 'Strong club-level play' },
  crazy: { label: 'Crazy Hard', note: 'Full-power Stockfish' },
};

function formatClock(value: number): string {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function opposite(color: Color): Color { return color === 'white' ? 'black' : 'white'; }
function chooseColor(choice: SideChoice): Color { return choice === 'random' ? (Math.random() < .5 ? 'white' : 'black') : choice; }

function gameResult(pos: Chess): string | null {
  if (pos.isCheckmate()) return pos.turn === 'white' ? 'Black wins by checkmate' : 'White wins by checkmate';
  if (pos.isStalemate()) return 'Draw by stalemate';
  if (pos.isInsufficientMaterial()) return 'Draw by insufficient material';
  if (pos.isEnd()) return 'Game over';
  return null;
}

function squareToPosition(square: Key): { x: number; z: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return { x: file - 3.5, z: 4.5 - rank };
}

function parseBoardFen(fen: string): FenPiece[] {
  const board = fen.split(' ')[0]?.split('/') ?? [];
  const pieces: FenPiece[] = [];
  board.forEach((row, rowIndex) => {
    let file = 0;
    for (const char of row) {
      if (/\d/.test(char)) {
        file += Number(char);
        continue;
      }
      const rank = 8 - rowIndex;
      const square = `${String.fromCharCode(97 + file)}${rank}` as Key;
      const color: Color = char === char.toUpperCase() ? 'white' : 'black';
      const lower = char.toLowerCase();
      const role: Role = lower === 'p'
        ? 'pawn'
        : lower === 'r'
          ? 'rook'
          : lower === 'n'
            ? 'knight'
            : lower === 'b'
              ? 'bishop'
              : lower === 'q'
                ? 'queen'
                : 'king';
      pieces.push({ square, color, role });
      file += 1;
    }
  });
  return pieces;
}

function createMaterialTheme(): PieceTheme {
  return {
    boardShell: new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.58, metalness: 0.28 }),
    boardInset: new THREE.MeshStandardMaterial({ color: 0x10141b, roughness: 0.68, metalness: 0.16 }),
    lightSquare: new THREE.MeshStandardMaterial({ color: 0x2a3039, roughness: 0.82, metalness: 0.08 }),
    darkSquare: new THREE.MeshStandardMaterial({ color: 0x080b10, roughness: 0.86, metalness: 0.10 }),
    whitePiece: new THREE.MeshStandardMaterial({ color: 0xf6f3eb, roughness: 0.30, metalness: 0.16 }),
    blackPiece: new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.28, metalness: 0.30 }),
    selected: new THREE.MeshStandardMaterial({ color: 0x66d7ad, emissive: 0x1b5d48, transparent: true, opacity: 0.9 }),
    legal: new THREE.MeshStandardMaterial({ color: 0x8de6c2, emissive: 0x14392d, transparent: true, opacity: 0.55 }),
  };
}

function withShadows<T extends THREE.Object3D>(value: T): T {
  value.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return value;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, y = 0): THREE.Mesh {
  const value = new THREE.Mesh(geometry, material);
  value.position.y = y;
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

function ring(group: THREE.Group, material: THREE.MeshStandardMaterial, radius = 0.24, tube = 0.05, y = 0.22) {
  const torus = mesh(new THREE.TorusGeometry(radius, tube, 14, 28), material, y);
  torus.rotation.x = Math.PI / 2;
  group.add(torus);
}

function makePiece(role: Role, material: THREE.MeshStandardMaterial): THREE.Group {
  const group = new THREE.Group();
  const segments = 22;
  group.add(mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.10, segments), material, 0.05));
  group.add(mesh(new THREE.CylinderGeometry(0.27, 0.34, 0.08, segments), material, 0.15));
  ring(group, material, 0.23, 0.032, 0.25);

  if (role === 'pawn') {
    group.add(mesh(new THREE.CylinderGeometry(0.14, 0.20, 0.42, segments), material, 0.44));
    group.add(mesh(new THREE.SphereGeometry(0.17, 22, 18), material, 0.73));
  } else if (role === 'rook') {
    group.add(mesh(new THREE.CylinderGeometry(0.20, 0.24, 0.56, segments), material, 0.48));
    group.add(mesh(new THREE.CylinderGeometry(0.30, 0.23, 0.12, segments), material, 0.82));
    for (let i = 0; i < 4; i += 1) {
      const crenel = mesh(new THREE.BoxGeometry(0.09, 0.12, 0.16), material, 0.96);
      const angle = (i / 4) * Math.PI * 2;
      crenel.position.x = Math.cos(angle) * 0.2;
      crenel.position.z = Math.sin(angle) * 0.2;
      group.add(crenel);
    }
  } else if (role === 'knight') {
    group.add(mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.34, segments), material, 0.38));
    const neck = mesh(new THREE.CapsuleGeometry(0.15, 0.38, 6, 14), material, 0.68);
    neck.rotation.z = -0.38;
    neck.position.x = 0.08;
    group.add(neck);
    const head = mesh(new THREE.BoxGeometry(0.26, 0.24, 0.20), material, 0.95);
    head.rotation.z = -0.26;
    head.position.x = 0.2;
    group.add(head);
    const ear = mesh(new THREE.ConeGeometry(0.06, 0.14, 10), material, 1.1);
    ear.rotation.z = -0.18;
    ear.position.set(0.14, 0, 0.05);
    group.add(ear);
  } else if (role === 'bishop') {
    group.add(mesh(new THREE.CylinderGeometry(0.15, 0.22, 0.58, segments), material, 0.49));
    group.add(mesh(new THREE.SphereGeometry(0.15, 18, 14), material, 0.87));
    const slit = mesh(new THREE.BoxGeometry(0.04, 0.22, 0.20), material, 0.95);
    slit.rotation.z = 0.65;
    group.add(slit);
    group.add(mesh(new THREE.SphereGeometry(0.06, 16, 12), material, 1.09));
  } else if (role === 'queen') {
    group.add(mesh(new THREE.CylinderGeometry(0.16, 0.23, 0.67, segments), material, 0.51));
    group.add(mesh(new THREE.CylinderGeometry(0.27, 0.17, 0.16, segments), material, 0.92));
    for (let i = 0; i < 6; i += 1) {
      const jewel = mesh(new THREE.SphereGeometry(0.05, 12, 10), material, 1.08);
      const angle = (i / 6) * Math.PI * 2;
      jewel.position.x = Math.cos(angle) * 0.13;
      jewel.position.z = Math.sin(angle) * 0.13;
      group.add(jewel);
    }
    group.add(mesh(new THREE.SphereGeometry(0.08, 18, 14), material, 1.1));
  } else {
    group.add(mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.70, segments), material, 0.52));
    group.add(mesh(new THREE.SphereGeometry(0.15, 18, 14), material, 0.95));
    const vertical = mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), material, 1.18);
    const horizontal = mesh(new THREE.BoxGeometry(0.24, 0.06, 0.08), material, 1.18);
    group.add(vertical, horizontal);
  }
  return withShadows(group);
}

function buildBoardScene(theme: PieceTheme): { boardRoot: THREE.Group; piecesGroup: THREE.Group; overlayGroup: THREE.Group; squareMeshes: THREE.Mesh[] } {
  const boardRoot = new THREE.Group();
  const piecesGroup = new THREE.Group();
  const overlayGroup = new THREE.Group();
  const squareMeshes: THREE.Mesh[] = [];

  const podium = mesh(new THREE.BoxGeometry(9.2, 0.48, 9.2), theme.boardShell, -0.24);
  podium.receiveShadow = true;
  boardRoot.add(podium);

  const tray = mesh(new THREE.BoxGeometry(8.7, 0.14, 8.7), theme.boardInset, -0.03);
  tray.receiveShadow = true;
  boardRoot.add(tray);

  for (let rank = 1; rank <= 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = `${String.fromCharCode(97 + file)}${rank}` as Key;
      const { x, z } = squareToPosition(square);
      const tile = mesh(new THREE.BoxGeometry(1, 0.08, 1), (file + rank) % 2 === 0 ? theme.darkSquare : theme.lightSquare, 0.04);
      tile.position.set(x, 0.04, z);
      tile.receiveShadow = true;
      tile.userData.square = square;
      squareMeshes.push(tile);
      boardRoot.add(tile);
    }
  }

  boardRoot.add(overlayGroup);
  boardRoot.add(piecesGroup);
  return { boardRoot, piecesGroup, overlayGroup, squareMeshes };
}

function clearDynamicGroup(group: THREE.Group) {
  group.traverse(object => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
  group.clear();
}

function cleanupScene(handle: SceneHandle, theme: PieceTheme) {
  handle.controls.dispose();
  handle.renderer.dispose();
  handle.scene.traverse(object => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
  Object.values(theme).forEach(material => material.dispose());
}

export default function PremiumBoard3D({ onBack }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const themeRef = useRef<PieceTheme | null>(null);
  const position = useRef<Chess | null>(null);
  const engine = useRef<Engine | null>(null);
  const enginePromise = useRef<Promise<Engine> | null>(null);
  const squareSelectHandler = useRef<(square: Key) => void>(() => {});

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
  const [selectedSquare, setSelectedSquare] = useState<Key | null>(null);
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null);

  const aiColor = mode === 'ai' && humanColor ? opposite(humanColor) : null;
  const backRank = useMemo(() => positionId === null ? '' : chess960BackRank(positionId), [positionId]);

  const ensureEngine = useCallback(async (): Promise<Engine> => {
    if (engine.current) return engine.current;
    if (!enginePromise.current) {
      enginePromise.current = import('../engine/stockfish').then(({ StockfishEngine }) => {
        const value = new StockfishEngine() as Engine;
        engine.current = value;
        return value;
      });
    }
    return enginePromise.current;
  }, []);

  const humanCanMove = useCallback((pos: Chess) => {
    if (phase !== 'playing') return false;
    return mode === 'human' || humanColor === pos.turn;
  }, [humanColor, mode, phase]);

  const syncBoardView = useCallback(() => {
    const scene = sceneRef.current;
    const theme = themeRef.current;
    if (!scene || !theme || !fen) return;

    scene.boardRoot.rotation.y = viewColor === 'black' ? Math.PI : 0;
    clearDynamicGroup(scene.overlayGroup);
    clearDynamicGroup(scene.piecesGroup);

    const pieces = parseBoardFen(fen);
    for (const item of pieces) {
      const part = makePiece(item.role, item.color === 'white' ? theme.whitePiece : theme.blackPiece);
      const { x, z } = squareToPosition(item.square);
      part.position.set(x, 0.12, z);
      if (item.color === 'black') part.rotation.y = Math.PI;
      scene.piecesGroup.add(part);
    }

    if (selectedSquare) {
      const pos = position.current;
      if (pos) {
        const { x, z } = squareToPosition(selectedSquare);
        const selected = mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.03, 28), theme.selected, 0.12);
        selected.position.set(x, 0.12, z);
        scene.overlayGroup.add(selected);

        const movesMap = chessgroundDests(pos, { chess960: true });
        const legal = movesMap.get(selectedSquare) ?? [];
        legal.forEach(dest => {
          const spot = squareToPosition(dest as Key);
          const hint = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 24), theme.legal, 0.12);
          hint.position.set(spot.x, 0.12, spot.z);
          scene.overlayGroup.add(hint);
        });
      }
    }

    scene.renderer.render(scene.scene, scene.camera);
  }, [fen, selectedSquare, viewColor]);

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
    setSelectedSquare(null);
    setPromotion(null);
    setEngineError('');
    setPhase('strategy');
  }, [mode, sideChoice]);

  const finishMove = useCallback((move: Move, orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || phase !== 'playing' || !pos.isLegal(move)) return false;
    const san = makeSan(pos, move);
    pos.play(move);
    setFen(makeFen(pos.toSetup()));
    setTurn(pos.turn);
    setMoves(values => [...values, san]);
    setSelectedSquare(null);
    const ending = gameResult(pos);
    if (ending) {
      setResult(ending);
      setPhase('ended');
      engine.current?.cancelSearch();
    }
    return true;
  }, [phase]);

  const handleSquareMove = useCallback((orig: Key, dest: Key) => {
    const pos = position.current;
    if (!pos || !humanCanMove(pos)) return;
    const square = parseSquare(orig);
    const piece = square === undefined ? undefined : pos.board.get(square);
    if (piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8')) {
      setPromotion({ orig, dest });
      return;
    }
    const move = parseUci(`${orig}${dest}`);
    if (!move) return;
    finishMove(move, orig, dest);
  }, [finishMove, humanCanMove]);

  const promote = useCallback((role: PromotionRole) => {
    if (!promotion) return;
    const suffix = role === 'queen' ? 'q' : role === 'rook' ? 'r' : role === 'bishop' ? 'b' : 'n';
    const move = parseUci(`${promotion.orig}${promotion.dest}${suffix}`);
    const pending = promotion;
    setPromotion(null);
    if (move) finishMove(move, pending.orig, pending.dest);
  }, [finishMove, promotion]);

  const handleSquareSelection = useCallback((square: Key) => {
    const pos = position.current;
    if (!pos || !humanCanMove(pos)) return;

    const parsed = parseSquare(square);
    const targetPiece = parsed === undefined ? undefined : pos.board.get(parsed);

    if (selectedSquare) {
      const legal = chessgroundDests(pos, { chess960: true }).get(selectedSquare) ?? [];
      if (legal.includes(square)) {
        handleSquareMove(selectedSquare, square);
        return;
      }
      if (targetPiece && targetPiece.color === pos.turn) {
        setSelectedSquare(square);
        return;
      }
      setSelectedSquare(null);
      return;
    }

    if (targetPiece && targetPiece.color === pos.turn) setSelectedSquare(square);
  }, [handleSquareMove, humanCanMove, selectedSquare]);

  squareSelectHandler.current = handleSquareSelection;

  useEffect(() => {
    const element = mount.current;
    if (!element) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090d);
    scene.fog = new THREE.Fog(0x07090d, 13, 24);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 9.8, 8.5);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(1, 1, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    element.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = false;
    controls.minDistance = 11.8;
    controls.maxDistance = 11.8;
    controls.minPolarAngle = 0.68;
    controls.maxPolarAngle = 1.1;
    controls.minAzimuthAngle = -0.8;
    controls.maxAzimuthAngle = 0.8;
    controls.target.set(0, 0.55, 0);
    controls.update();
    controls.addEventListener('change', () => sceneRef.current?.renderer.render(scene, camera));

    const theme = createMaterialTheme();
    themeRef.current = theme;

    const root = new THREE.Group();
    scene.add(root);

    const floor = mesh(new THREE.CylinderGeometry(9.8, 10.3, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.96 }), -0.45);
    floor.receiveShadow = true;
    root.add(floor);

    const { boardRoot, piecesGroup, overlayGroup, squareMeshes } = buildBoardScene(theme);
    root.add(boardRoot);

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x10141d, 1.45);
    scene.add(hemi);

    const fill = new THREE.DirectionalLight(0x8eb3ff, 0.65);
    fill.position.set(-6, 8, 4);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xb7ffe7, 0.42);
    rim.position.set(5, 4, -7);
    scene.add(rim);

    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4.8, 8.6, 5.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.00008;
    key.shadow.normalBias = 0.018;
    scene.add(key);
    scene.add(key.target);
    key.target.position.set(0, 0.2, 0);

    const raycaster = new THREE.Raycaster();
    let downSquare: Key | null = null;
    let pointerMoved = false;
    let startX = 0;
    let startY = 0;

    const pickSquare = (event: PointerEvent): Key | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(squareMeshes, false)[0];
      return (hit?.object.userData.square as Key | undefined) ?? null;
    };

    const onDown = (event: PointerEvent) => {
      startX = event.clientX;
      startY = event.clientY;
      pointerMoved = false;
      downSquare = pickSquare(event);
    };

    const onMove = (event: PointerEvent) => {
      if (Math.abs(event.clientX - startX) > 6 || Math.abs(event.clientY - startY) > 6) pointerMoved = true;
    };

    const onUp = (event: PointerEvent) => {
      if (pointerMoved) return;
      const upSquare = pickSquare(event);
      if (downSquare && upSquare && downSquare === upSquare) squareSelectHandler.current(upSquare);
    };

    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

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
    resize();

    sceneRef.current = { scene, camera, renderer, controls, root, boardRoot, piecesGroup, overlayGroup, squareMeshes, raycaster };

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onUp);
      if (sceneRef.current) cleanupScene(sceneRef.current, theme);
      sceneRef.current = null;
      themeRef.current = null;
      element.replaceChildren();
    };
  }, []);

  useEffect(() => { syncBoardView(); }, [syncBoardView]);

  useEffect(() => {
    if (mode !== 'ai' || positionId === null) {
      setEngineStatus('off');
      return;
    }
    let cancelled = false;
    setEngineStatus('loading');
    void ensureEngine()
      .then(value => value.init())
      .then(() => { if (!cancelled) setEngineStatus('ready'); })
      .catch(error => {
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
    const delay = fastForward ? 250 : 1000;
    const timer = window.setTimeout(() => setStrategyTime(value => Math.max(0, value - 1)), delay);
    return () => window.clearTimeout(timer);
  }, [fastForward, phase, strategyTime]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      const pos = position.current;
      if (!pos) return;
      if (mode === 'ai' && pos.turn === aiColor && engineStatus === 'loading') return;
      const setter = pos.turn === 'white' ? setWhiteClock : setBlackClock;
      setter(value => {
        const next = Math.max(0, value - 1);
        if (next === 0) {
          setResult(pos.turn === 'white' ? 'Black wins on time' : 'White wins on time');
          setPhase('ended');
          engine.current?.cancelSearch();
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [aiColor, engineStatus, mode, phase]);

  useEffect(() => {
    const pos = position.current;
    if (phase !== 'playing' || mode !== 'ai' || !aiColor || !pos || pos.turn !== aiColor || result) return;
    let cancelled = false;
    const snapshot = makeFen(pos.toSetup());
    const run = async () => {
      try {
        const value = await ensureEngine();
        if (!value.isReady()) {
          setEngineStatus('loading');
          await value.init();
        }
        if (cancelled) return;
        setEngineStatus('thinking');
        const uci = await value.bestMove(snapshot, difficulty);
        if (cancelled) return;
        const current = position.current;
        if (!current || current.turn !== aiColor || makeFen(current.toSetup()) !== snapshot) return;
        const move = parseUci(uci);
        if (!move || !current.isLegal(move)) throw new Error('Stockfish returned an invalid move.');
        finishMove(move, uci.slice(0, 2) as Key, uci.slice(2, 4) as Key);
        setEngineStatus('ready');
      } catch (error) {
        if (!cancelled) {
          setEngineStatus('error');
          setEngineError(error instanceof Error ? error.message : 'Stockfish could not move.');
        }
      }
    };
    void run();
    return () => { cancelled = true; engine.current?.cancelSearch(); };
  }, [aiColor, difficulty, ensureEngine, fen, finishMove, mode, phase, result, turn]);

  useEffect(() => () => engine.current?.destroy(), []);

  const startNow = () => {
    if (phase === 'strategy') {
      setStrategyTime(0);
      setFastForward(false);
      setPhase('playing');
    }
  };

  const playerName = (color: Color) => mode === 'ai' && aiColor === color
    ? `Stockfish · ${DIFFICULTIES[difficulty].label}`
    : mode === 'ai'
      ? 'You'
      : color === 'white'
        ? 'White'
        : 'Black';

  return (
    <div className="premium-page-v14 qqurz-content-page three-play-page">
      <section className="page-heading-v14 compact">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">3D BOARD LAB</span>
        <h1>Sharper 3D, darker board, playable from the same Chess960 rules.</h1>
        <p>A premium-style angled top-down board with shadows, smoother materials, and local Human vs Human or AI play for testing.</p>
      </section>

      <section className="three-setup-card">
        <div className="local-mode-switch" role="radiogroup" aria-label="3D game mode">
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
                    <b>{DIFFICULTIES[level].label}</b>
                    <small>{DIFFICULTIES[level].note}</small>
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
          <button className="secondary-clean" onClick={() => setViewColor(value => opposite(value))} disabled={positionId === null}>Flip view</button>
          <span className="three-inline-note">Angled top-down camera · retina rendering · soft shadows</span>
        </div>
      </section>

      <section className="three-play-grid">
        <div className="three-main-column">
          <section className="three-board-card high-fidelity">
            <div ref={mount} className="three-board-mount" aria-label="Interactive 3D chess board" />
            <div className="three-preview-badge">LIVE 3D TEST</div>
            <div className="three-board-help">Drag lightly to orbit · tap a piece, then tap a square</div>

            {phase === 'strategy' && (
              <div className="local-board-overlay">
                <span>STRATEGY</span>
                <strong>{formatClock(strategyTime)}</strong>
                <p>Study the randomized Chess960 layout while the game prepares. Hold to fast-forward or start immediately.</p>
                <div>
                  <button onPointerDown={() => setFastForward(true)} onPointerUp={() => setFastForward(false)} onPointerCancel={() => setFastForward(false)}>Hold ×{FAST_FORWARD_RATE}</button>
                  <button className="primary-black" onClick={startNow}>Start Now</button>
                </div>
              </div>
            )}

            {phase === 'ended' && result && (
              <div className="local-board-overlay ended">
                <span>GAME OVER</span>
                <strong className="end-title">{result}</strong>
                <button className="primary-black" onClick={createPosition}>New position</button>
              </div>
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
            <div className={turn === 'black' && phase === 'playing' ? 'active' : ''}><span>{playerName('black')}</span><strong>{formatClock(blackClock)}</strong></div>
            <div className={turn === 'white' && phase === 'playing' ? 'active' : ''}><span>{playerName('white')}</span><strong>{formatClock(whiteClock)}</strong></div>
          </div>

          {mode === 'ai' && (
            <div className={`local-engine-state ${engineStatus}`}>
              {engineStatus === 'loading'
                ? 'Loading Stockfish in the background…'
                : engineStatus === 'thinking'
                  ? 'Stockfish thinking…'
                  : engineStatus === 'ready'
                    ? 'Stockfish ready'
                    : engineError || 'AI preparing'}
            </div>
          )}

          <div className="three-panel muted">
            <span className="qqurz-kicker">3D NOTES</span>
            <ul className="three-note-list">
              <li>Board theme is now darker by default.</li>
              <li>3D uses Retina pixel ratio, ACES filmic tone mapping, and current Three.js PCF soft shadows.</li>
              <li>This route is for local 3D play testing before paid/premium gating.</li>
            </ul>
          </div>

          <div className="three-panel moves">
            <span className="qqurz-kicker">MOVES</span>
            {moves.length ? <ol>{moves.map((move, index) => <li key={`${move}-${index}`}>{move}</li>)}</ol> : <p>No moves yet.</p>}
          </div>
        </aside>
      </section>

      {promotion && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
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
