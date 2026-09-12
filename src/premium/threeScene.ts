import type { Color, Key } from '@lichess-org/chessground/types';
import type { Role } from 'chessops/types';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cappedPixelRatio, createRenderScheduler, shadowMapSize, type RenderScheduler } from './threePerformance';
import { MAX_LEGAL_DESTS, MAX_ROLE_INSTANCES, THREE_COLORS, THREE_ROLES, pieceGeometry, piecesFromFen, setInstanceMatrix, squarePosition } from './threeGeometry';

export type ThreeSceneHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  board: THREE.Group;
  pieceMeshes: Map<string, THREE.InstancedMesh>;
  selectedRing: THREE.Mesh;
  legalDots: THREE.InstancedMesh;
  scheduler: RenderScheduler;
  resetCamera: () => void;
};

function materialSet() {
  return {
    shell: new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: .68, metalness: .05 }),
    inset: new THREE.MeshStandardMaterial({ color: 0x6b452c, roughness: .74, metalness: .03 }),
    light: new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: .78, metalness: .01 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x6f452a, roughness: .82, metalness: .01 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2eee5, roughness: .35, metalness: .08 }),
    black: new THREE.MeshStandardMaterial({ color: 0x171513, roughness: .32, metalness: .12 }),
    selected: new THREE.MeshStandardMaterial({ color: 0x6adbb1, emissive: 0x173d31, transparent: true, opacity: .92, side: THREE.DoubleSide }),
    legal: new THREE.MeshStandardMaterial({ color: 0x58d38f, emissive: 0x143b2a, transparent: true, opacity: .88, side: THREE.DoubleSide }),
    table: new THREE.MeshStandardMaterial({ color: 0x31251d, roughness: .94 }),
  };
}

export function createThreeScene(element: HTMLDivElement): { handle: ThreeSceneHandle; cleanup: () => void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4b3a2d);
  scene.fog = new THREE.Fog(0x4b3a2d, 29, 48);
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(cappedPixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
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

  const railGeometry = new THREE.BoxGeometry(1, 1, 1);
  const rails = new THREE.InstancedMesh(railGeometry, mats.shell, 4);
  setInstanceMatrix(rails, 0, 0, -.12, -4.45, 0, 9.35, .48, .45);
  setInstanceMatrix(rails, 1, 0, -.12, 4.45, 0, 9.35, .48, .45);
  setInstanceMatrix(rails, 2, -4.45, -.12, 0, 0, .45, .48, 8.45);
  setInstanceMatrix(rails, 3, 4.45, -.12, 0, 0, .45, .48, 8.45);
  rails.receiveShadow = true;
  board.add(rails);

  const insetGeometry = new THREE.PlaneGeometry(8.8, 8.8);
  insetGeometry.rotateX(-Math.PI / 2);
  const inset = new THREE.Mesh(insetGeometry, mats.inset);
  inset.position.y = -.005;
  inset.receiveShadow = true;
  board.add(inset);

  const squareGeometry = new THREE.PlaneGeometry(.995, .995);
  squareGeometry.rotateX(-Math.PI / 2);
  const lightSquares = new THREE.InstancedMesh(squareGeometry, mats.light, 32);
  const darkSquares = new THREE.InstancedMesh(squareGeometry, mats.dark, 32);
  let lightIndex = 0;
  let darkIndex = 0;
  for (let rank = 1; rank <= 8; rank += 1) for (let file = 0; file < 8; file += 1) {
    const square = `${String.fromCharCode(97 + file)}${rank}` as Key;
    const point = squarePosition(square);
    const target = (file + rank) % 2 === 0 ? darkSquares : lightSquares;
    setInstanceMatrix(target, target === darkSquares ? darkIndex++ : lightIndex++, point.x, .055, point.z);
  }
  lightSquares.receiveShadow = true;
  darkSquares.receiveShadow = true;
  board.add(lightSquares, darkSquares);

  const roleGeometry = new Map<Role, THREE.BufferGeometry>();
  const pieceMeshes = new Map<string, THREE.InstancedMesh>();
  for (const role of THREE_ROLES) roleGeometry.set(role, pieceGeometry(role));
  for (const color of THREE_COLORS) for (const role of THREE_ROLES) {
    const instances = new THREE.InstancedMesh(roleGeometry.get(role)!, color === 'white' ? mats.white : mats.black, MAX_ROLE_INSTANCES);
    instances.count = 0;
    instances.castShadow = true;
    instances.receiveShadow = true;
    pieceMeshes.set(`${color}:${role}`, instances);
    board.add(instances);
  }

  const ringGeometry = new THREE.RingGeometry(.28, .39, 20);
  ringGeometry.rotateX(-Math.PI / 2);
  const selectedRing = new THREE.Mesh(ringGeometry, mats.selected);
  selectedRing.position.y = .075;
  selectedRing.visible = false;
  board.add(selectedRing);

  const dotGeometry = new THREE.CircleGeometry(.105, 14);
  dotGeometry.rotateX(-Math.PI / 2);
  const legalDots = new THREE.InstancedMesh(dotGeometry, mats.legal, MAX_LEGAL_DESTS);
  legalDots.count = 0;
  board.add(legalDots);

  const table = new THREE.Mesh(new THREE.CylinderGeometry(12.2, 12.7, .14, 32), mats.table);
  table.position.y = -.47;
  table.receiveShadow = true;
  scene.add(table);
  scene.add(new THREE.HemisphereLight(0xfff7ed, 0x6f5847, 1.9));
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.position.set(5.5, 11, 8.5);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize(), shadowMapSize());
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  key.shadow.bias = -.00006;
  key.shadow.normalBias = .014;
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
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  resize();

  const handle = { scene, camera, renderer, controls, board, pieceMeshes, selectedRing, legalDots, scheduler, resetCamera };
  const cleanup = () => {
    observer.disconnect();
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

export function syncThreePieces(handle: ThreeSceneHandle, fen: string, orientation: Color) {
  handle.board.rotation.y = orientation === 'black' ? Math.PI : 0;
  const grouped = new Map<string, ReturnType<typeof piecesFromFen>>();
  for (const color of THREE_COLORS) for (const role of THREE_ROLES) grouped.set(`${color}:${role}`, []);
  for (const piece of piecesFromFen(fen)) grouped.get(`${piece.color}:${piece.role}`)!.push(piece);
  for (const [key, mesh] of handle.pieceMeshes) {
    const items = grouped.get(key) ?? [];
    mesh.count = Math.min(items.length, MAX_ROLE_INSTANCES);
    items.slice(0, MAX_ROLE_INSTANCES).forEach((piece, index) => {
      const point = squarePosition(piece.square);
      setInstanceMatrix(mesh, index, point.x, .08, point.z, piece.color === 'black' ? Math.PI : 0);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  handle.scheduler.render();
}

export function syncThreeSelection(handle: ThreeSceneHandle, selected: Key | null, legalDests: Map<string, string[]>, movableColor?: Color) {
  if (!selected || !movableColor) {
    handle.selectedRing.visible = false;
    handle.legalDots.count = 0;
    handle.legalDots.instanceMatrix.needsUpdate = true;
    handle.scheduler.render();
    return;
  }
  const point = squarePosition(selected);
  handle.selectedRing.visible = true;
  handle.selectedRing.position.set(point.x, .075, point.z);
  const destinations = (legalDests.get(selected) ?? []).slice(0, MAX_LEGAL_DESTS);
  handle.legalDots.count = destinations.length;
  destinations.forEach((destination, index) => {
    const dest = squarePosition(destination as Key);
    setInstanceMatrix(handle.legalDots, index, dest.x, .08, dest.z);
  });
  handle.legalDots.instanceMatrix.needsUpdate = true;
  handle.scheduler.render();
}
