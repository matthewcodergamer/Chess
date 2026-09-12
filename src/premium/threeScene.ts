import type { Key } from '@lichess-org/chessground/types';
import type { Role } from 'chessops/types';
import type { ChessBoardViewState } from '../game/boardViewState';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cappedPixelRatio, createRenderScheduler, lowerPower3DDevice, shadowMapSize, webglPowerPreference, type RenderScheduler } from './threePerformance';
import { MAX_LEGAL_DESTS, MAX_ROLE_INSTANCES, THREE_ROLES, pieceGeometry, piecesFromFen, setInstanceMatrix, squarePosition } from './threeGeometry';

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

const WHITE_PIECE = new THREE.Color(0xf2eee5);
const BLACK_PIECE = new THREE.Color(0x171513);
const LIGHT_SQUARE = new THREE.Color(0xb98a5e);
const DARK_SQUARE = new THREE.Color(0x6f452a);

function materialSet() {
  return {
    shell: new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: .68, metalness: .05 }),
    inset: new THREE.MeshStandardMaterial({ color: 0x6b452c, roughness: .74, metalness: .03 }),
    square: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .80, metalness: .01 }),
    piece: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .34, metalness: .10 }),
    selected: new THREE.MeshBasicMaterial({ color: 0x6adbb1, transparent: true, opacity: .88, side: THREE.DoubleSide, depthWrite: false }),
    legal: new THREE.MeshBasicMaterial({ color: 0x58d38f, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false }),
    lastMove: new THREE.MeshBasicMaterial({ color: 0xe7b45b, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false }),
    table: new THREE.MeshStandardMaterial({ color: 0x31251d, roughness: .94 }),
  };
}

export function createThreeScene(element: HTMLDivElement): { handle: ThreeSceneHandle; cleanup: () => void } {
  const lowPower = lowerPower3DDevice();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4b3a2d);
  scene.fog = new THREE.Fog(0x4b3a2d, 29, 48);
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  const renderer = new THREE.WebGLRenderer({
    antialias: !lowPower,
    alpha: false,
    powerPreference: webglPowerPreference(),
  });
  renderer.setPixelRatio(cappedPixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  // Older iPhones start on the cooler path. Faster devices can keep shadows
  // until the adaptive scheduler decides that frame time is too expensive.
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  element.replaceChildren(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.rotateSpeed = .48;
  controls.zoomSpeed = .7;
  controls.minDistance = 19;
  controls.maxDistance = 32;
  controls.minPolarAngle = .54;
  controls.maxPolarAngle = 1.04;
  controls.minAzimuthAngle = -.82;
  controls.maxAzimuthAngle = .82;
  controls.target.set(0, .35, .95);

  const scheduler = createRenderScheduler(renderer, scene, camera, controls);
  const resetCamera = () => {
    camera.position.set(0, 17.4, 20.6);
    controls.target.set(0, .35, .95);
    controls.update();
    scheduler.render();
  };
  resetCamera();

  const mats = materialSet();
  const board = new THREE.Group();
  scene.add(board);

  // Four frame rails share one cube geometry + material and render as one draw.
  const railGeometry = new THREE.BoxGeometry(1, 1, 1);
  const rails = new THREE.InstancedMesh(railGeometry, mats.shell, 4);
  setInstanceMatrix(rails, 0, 0, -.12, -4.45, 0, 9.35, .48, .45);
  setInstanceMatrix(rails, 1, 0, -.12, 4.45, 0, 9.35, .48, .45);
  setInstanceMatrix(rails, 2, -4.45, -.12, 0, 0, .45, .48, 8.45);
  setInstanceMatrix(rails, 3, 4.45, -.12, 0, 0, .45, .48, 8.45);
  rails.receiveShadow = renderer.shadowMap.enabled;
  board.add(rails);

  const insetGeometry = new THREE.PlaneGeometry(8.8, 8.8);
  insetGeometry.rotateX(-Math.PI / 2);
  const inset = new THREE.Mesh(insetGeometry, mats.inset);
  inset.position.y = -.005;
  inset.receiveShadow = renderer.shadowMap.enabled;
  board.add(inset);

  // One instanced mesh for all 64 top surfaces; per-instance color preserves
  // the light/dark board while cutting square draw calls from two to one.
  const squareGeometry = new THREE.PlaneGeometry(.995, .995);
  squareGeometry.rotateX(-Math.PI / 2);
  const squares = new THREE.InstancedMesh(squareGeometry, mats.square, 64);
  let squareIndex = 0;
  for (let rank = 1; rank <= 8; rank += 1) for (let file = 0; file < 8; file += 1) {
    const square = `${String.fromCharCode(97 + file)}${rank}` as Key;
    const point = squarePosition(square);
    setInstanceMatrix(squares, squareIndex, point.x, .055, point.z);
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
  selectedRing.position.y = .078;
  selectedRing.visible = false;
  board.add(selectedRing);

  const dotGeometry = new THREE.CircleGeometry(.105, lowPower ? 8 : 12);
  dotGeometry.rotateX(-Math.PI / 2);
  const legalDots = new THREE.InstancedMesh(dotGeometry, mats.legal, MAX_LEGAL_DESTS);
  legalDots.count = 0;
  legalDots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  board.add(legalDots);

  const lastMoveTiles = new THREE.InstancedMesh(squareGeometry, mats.lastMove, 2);
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

  scene.add(new THREE.HemisphereLight(0xfff7ed, 0x6f5847, 1.9));
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.position.set(5.5, 11, 8.5);
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
  key.target.position.set(0, .25, 1.2);

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
    scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
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
      setInstanceMatrix(mesh, index, point.x, .08, point.z);
      mesh.setColorAt(index, piece.color === 'white' ? WHITE_PIECE : BLACK_PIECE);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  if (state.lastMove) {
    handle.lastMoveTiles.count = 2;
    state.lastMove.forEach((square, index) => {
      const point = squarePosition(square);
      setInstanceMatrix(handle.lastMoveTiles, index, point.x, .071, point.z, 0, .94, 1, .94);
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
  handle.selectedRing.position.set(point.x, .078, point.z);
  const destinations = [...(state.legalDests.get(selected) ?? [])].slice(0, MAX_LEGAL_DESTS);
  handle.legalDots.count = destinations.length;
  destinations.forEach((destination, index) => {
    const dest = squarePosition(destination);
    setInstanceMatrix(handle.legalDots, index, dest.x, .081, dest.z);
  });
  handle.legalDots.instanceMatrix.needsUpdate = true;
  handle.scheduler.render();
}
