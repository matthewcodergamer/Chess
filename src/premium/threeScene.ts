import type { Key } from '@lichess-org/chessground/types';
import type { Role } from 'chessops/types';
import type { ChessBoardViewState } from '../game/boardViewState';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cappedPixelRatio, createRenderScheduler, lowerPower3DDevice, shadowMapSize, webglPowerPreference, type RenderScheduler } from './threePerformance';
import { MAX_LEGAL_DESTS, MAX_ROLE_INSTANCES, SQUARE_TOP, THREE_ROLES, pieceGeometry, piecesFromFen, setInstanceMatrix, squarePosition } from './threeGeometry';

export type ThreeSceneHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  board: THREE.Group;
  pieceMeshes: Map<Role, THREE.InstancedMesh>;
  selectedRing: THREE.Mesh;
  legalDots: THREE.InstancedMesh;
  lastMoveTiles: THREE.InstancedMesh;
  scheduler: RenderScheduler;
  resetCamera: () => void;
};

// Studio Staunton: espresso / beech sampled from the product photos.
const WHITE_PIECE = new THREE.Color(0xE8B496);
const BLACK_PIECE = new THREE.Color(0x5A3832);
const LIGHT_SQUARE = new THREE.Color(0xC9A06C);
const DARK_SQUARE = new THREE.Color(0x7A4A2C);
const STUDIO = 0x3E3A36;

function woodGrainTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#c8c4be';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 48; i += 1) {
    const shade = 150 + (i % 7) * 10;
    ctx.strokeStyle = `rgba(${shade},${shade - 8},${shade - 16},0.55)`;
    ctx.lineWidth = 1.1 + (i % 3);
    ctx.beginPath();
    const y = (i / 48) * size;
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 10) {
      ctx.lineTo(x, y + Math.sin(x * 0.035 + i * 0.7) * 7 + Math.sin(x * 0.01 + i) * 12);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 900; i += 1) {
    const shade = 120 + Math.random() * 80;
    ctx.fillStyle = `rgba(${shade},${shade - 6},${shade - 14},0.28)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.2, 2 + Math.random() * 5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.NoColorSpace;
  texture.repeat.set(2, 3);
  return texture;
}

function materialSet(grain: THREE.CanvasTexture | null) {
  const piece = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.52,
    metalness: 0.02,
    clearcoat: 0.22,
    clearcoatRoughness: 0.45,
    sheen: 0.18,
    sheenColor: new THREE.Color(0xc4a07a),
    bumpScale: 0.028,
  });
  const square = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.02,
    bumpScale: 0.035,
  });
  const shell = new THREE.MeshStandardMaterial({
    color: 0x6B4423,
    roughness: 0.72,
    metalness: 0.03,
    bumpScale: 0.04,
  });
  if (grain) {
    piece.bumpMap = grain;
    piece.roughnessMap = grain;
    square.bumpMap = grain;
    square.roughnessMap = grain;
    shell.bumpMap = grain;
    shell.roughnessMap = grain;
  }
  return {
    shell,
    inset: new THREE.MeshStandardMaterial({ color: 0x5A3820, roughness: 0.82, metalness: 0.02 }),
    square,
    piece,
    selected: new THREE.MeshBasicMaterial({ color: 0x6adbb1, transparent: true, opacity: .88, side: THREE.DoubleSide, depthWrite: false }),
    legal: new THREE.MeshBasicMaterial({ color: 0x58d38f, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false }),
    lastMove: new THREE.MeshBasicMaterial({ color: 0xe7b45b, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false }),
    table: new THREE.MeshStandardMaterial({ color: 0x3A3530, roughness: .96 }),
  };
}

export function createThreeScene(element: HTMLDivElement): { handle: ThreeSceneHandle; cleanup: () => void } {
  const lowPower = lowerPower3DDevice();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(STUDIO);
  scene.fog = new THREE.Fog(STUDIO, 24, 44);
  const camera = new THREE.PerspectiveCamera(28, 1, .1, 100);
  const renderer = new THREE.WebGLRenderer({
    antialias: !lowPower,
    alpha: false,
    powerPreference: webglPowerPreference(),
  });
  renderer.setPixelRatio(cappedPixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  // Older iPhones start on the cooler path. Faster devices can keep shadows
  // until the adaptive scheduler decides that frame time is too expensive.
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  element.replaceChildren(renderer.domElement);

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(environment, 0.06).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.38;
  environment.dispose();
  pmrem.dispose();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.rotateSpeed = .48;
  controls.zoomSpeed = .7;
  controls.minDistance = 16;
  controls.maxDistance = 30;
  controls.minPolarAngle = .62;
  controls.maxPolarAngle = 1.18;
  controls.minAzimuthAngle = -1.02;
  controls.maxAzimuthAngle = 1.02;
  controls.target.set(0.15, 0.12, 0.2);

  const scheduler = createRenderScheduler(renderer, scene, camera, controls);
  const resetCamera = () => {
    camera.position.set(10.4, 11.2, 15.4);
    controls.target.set(0.15, 0.12, 0.2);
    controls.update();
    scheduler.render();
  };
  resetCamera();

  const grain = woodGrainTexture();
  const mats = materialSet(grain);
  const board = new THREE.Group();
  scene.add(board);

  const chassis = new THREE.Mesh(new RoundedBoxGeometry(9.72, 0.36, 9.72, 2, 0.08), mats.shell);
  chassis.position.y = -0.06;
  chassis.castShadow = renderer.shadowMap.enabled;
  chassis.receiveShadow = renderer.shadowMap.enabled;
  board.add(chassis);

  // Four frame rails share one cube geometry + material and render as one draw.
  const railGeometry = new THREE.BoxGeometry(1, 1, 1);
  const rails = new THREE.InstancedMesh(railGeometry, mats.shell, 4);
  setInstanceMatrix(rails, 0, 0, 0.02, -4.46, 0, 9.72, 0.40, 0.92);
  setInstanceMatrix(rails, 1, 0, 0.02, 4.46, 0, 9.72, 0.40, 0.92);
  setInstanceMatrix(rails, 2, -4.46, 0.02, 0, 0, 0.92, 0.40, 7.88);
  setInstanceMatrix(rails, 3, 4.46, 0.02, 0, 0, 0.92, 0.40, 7.88);
  rails.instanceMatrix.needsUpdate = true;
  rails.castShadow = renderer.shadowMap.enabled;
  rails.receiveShadow = renderer.shadowMap.enabled;
  board.add(rails);

  const insetGeometry = new THREE.PlaneGeometry(8.8, 8.8);
  insetGeometry.rotateX(-Math.PI / 2);
  const inset = new THREE.Mesh(insetGeometry, mats.inset);
  inset.position.y = 0.11;
  inset.receiveShadow = renderer.shadowMap.enabled;
  board.add(inset);

  // One instanced mesh for all 64 top surfaces; per-instance color preserves
  // the light/dark board while cutting square draw calls from two to one.
  const squareGeometry = new THREE.BoxGeometry(.995, .07, .995);
  const squares = new THREE.InstancedMesh(squareGeometry, mats.square, 64);
  let squareIndex = 0;
  for (let rank = 1; rank <= 8; rank += 1) for (let file = 0; file < 8; file += 1) {
    const square = `${String.fromCharCode(97 + file)}${rank}` as Key;
    const point = squarePosition(square);
    setInstanceMatrix(squares, squareIndex, point.x, SQUARE_TOP - 0.035, point.z);
    squares.setColorAt(squareIndex, (file + rank) % 2 === 0 ? DARK_SQUARE : LIGHT_SQUARE);
    squareIndex += 1;
  }
  squares.instanceColor!.needsUpdate = true;
  squares.receiveShadow = renderer.shadowMap.enabled;
  board.add(squares);

  // One instanced mesh per role, not per role+color. Instance colors distinguish
  // sides, halving worst-case piece draw calls from twelve to six.
  const pieceMeshes = new Map<Role, THREE.InstancedMesh>();
  for (const role of THREE_ROLES) {
    const geometry = pieceGeometry(role, lowPower ? 9 : 12);
    const instances = new THREE.InstancedMesh(geometry, mats.piece, MAX_ROLE_INSTANCES);
    instances.count = 0;
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instances.castShadow = renderer.shadowMap.enabled;
    instances.receiveShadow = false;
    pieceMeshes.set(role, instances);
    board.add(instances);
  }

  const ringGeometry = new THREE.RingGeometry(.28, .39, lowPower ? 12 : 18);
  ringGeometry.rotateX(-Math.PI / 2);
  const selectedRing = new THREE.Mesh(ringGeometry, mats.selected);
  selectedRing.position.y = SQUARE_TOP + 0.012;
  selectedRing.visible = false;
  board.add(selectedRing);

  const dotGeometry = new THREE.CircleGeometry(.105, lowPower ? 8 : 12);
  dotGeometry.rotateX(-Math.PI / 2);
  const legalDots = new THREE.InstancedMesh(dotGeometry, mats.legal, MAX_LEGAL_DESTS);
  legalDots.count = 0;
  legalDots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  board.add(legalDots);

  const overlayGeometry = new THREE.PlaneGeometry(.995, .995);
  overlayGeometry.rotateX(-Math.PI / 2);
  const lastMoveTiles = new THREE.InstancedMesh(overlayGeometry, mats.lastMove, 2);
  lastMoveTiles.count = 0;
  lastMoveTiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  board.add(lastMoveTiles);

  // The play camera never sees the underside of the table, so render only its
  // top surface instead of a closed cylinder.
  const tableGeometry = new THREE.CircleGeometry(12.2, lowPower ? 24 : 32);
  tableGeometry.rotateX(-Math.PI / 2);
  const table = new THREE.Mesh(tableGeometry, mats.table);
  table.position.y = -.42;
  table.receiveShadow = renderer.shadowMap.enabled;
  scene.add(table);

  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x5a4a3c, 1.2));
  const key = new THREE.DirectionalLight(0xfff6ea, 2.45);
  key.position.set(-4.2, 12.5, 8.2);
  key.castShadow = renderer.shadowMap.enabled;
  if (renderer.shadowMap.enabled) {
    key.shadow.mapSize.set(shadowMapSize(), shadowMapSize());
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.bias = -.00006;
    key.shadow.normalBias = .014;
  }
  scene.add(key, key.target);
  key.target.position.set(0, .2, 0.4);
  const fill = new THREE.DirectionalLight(0xcbb9a4, 0.72);
  fill.position.set(7.5, 5.5, -3.5);
  scene.add(fill);

  const resize = () => {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    scheduler.render();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);

  const intersectionObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => scheduler.setViewportVisible(Boolean(entries[0]?.isIntersecting)), { rootMargin: '80px' })
    : null;
  intersectionObserver?.observe(element);
  resize();

  const handle = { scene, camera, renderer, controls, board, pieceMeshes, selectedRing, legalDots, lastMoveTiles, scheduler, resetCamera };
  const cleanup = () => {
    resizeObserver.disconnect();
    intersectionObserver?.disconnect();
    scheduler.dispose();
    controls.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    if (grain) textures.add(grain);
    if (envMap) textures.add(envMap);
    scene.environment = null;
    scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    renderer.dispose();
    element.replaceChildren();
  };
  return { handle, cleanup };
}

export function syncThreePieces(handle: ThreeSceneHandle, state: ChessBoardViewState) {
  handle.board.rotation.y = state.orientation === 'black' ? Math.PI : 0;
  const grouped = new Map<Role, ReturnType<typeof piecesFromFen>>();
  for (const role of THREE_ROLES) grouped.set(role, []);
  for (const piece of piecesFromFen(state.fen)) grouped.get(piece.role)!.push(piece);

  for (const [role, mesh] of handle.pieceMeshes) {
    const items = grouped.get(role) ?? [];
    mesh.count = Math.min(items.length, MAX_ROLE_INSTANCES);
    items.slice(0, MAX_ROLE_INSTANCES).forEach((piece, index) => {
      const point = squarePosition(piece.square);
      const file = piece.square.charCodeAt(0) - 97;
      const yaw = role === 'knight' ? (file < 4 ? Math.PI / 2 : -Math.PI / 2) : 0;
      setInstanceMatrix(mesh, index, point.x, SQUARE_TOP, point.z, yaw);
      mesh.setColorAt(index, piece.color === 'white' ? WHITE_PIECE : BLACK_PIECE);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  if (state.lastMove) {
    handle.lastMoveTiles.count = 2;
    state.lastMove.forEach((square, index) => {
      const point = squarePosition(square);
      setInstanceMatrix(handle.lastMoveTiles, index, point.x, SQUARE_TOP + 0.004, point.z, 0, .94, 1, .94);
    });
    handle.lastMoveTiles.instanceMatrix.needsUpdate = true;
  } else {
    handle.lastMoveTiles.count = 0;
  }
  handle.scheduler.render();
}

export function syncThreeSelection(handle: ThreeSceneHandle, selected: Key | null, state: ChessBoardViewState) {
  if (!selected || !state.movableColor) {
    handle.selectedRing.visible = false;
    handle.legalDots.count = 0;
    handle.legalDots.instanceMatrix.needsUpdate = true;
    handle.scheduler.render();
    return;
  }
  const point = squarePosition(selected);
  handle.selectedRing.visible = true;
  handle.selectedRing.position.set(point.x, SQUARE_TOP + 0.012, point.z);
  const destinations = [...(state.legalDests.get(selected) ?? [])].slice(0, MAX_LEGAL_DESTS);
  handle.legalDots.count = destinations.length;
  destinations.forEach((destination, index) => {
    const dest = squarePosition(destination);
    setInstanceMatrix(handle.legalDots, index, dest.x, SQUARE_TOP + 0.014, dest.z);
  });
  handle.legalDots.instanceMatrix.needsUpdate = true;
  handle.scheduler.render();
}
