import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type ClockSide = 'white' | 'black';

export type ChessClockModel = {
  group: THREE.Group;
  rocker: THREE.Group;
  hitMeshes: THREE.Mesh[];
  displayTexture: THREE.CanvasTexture;
  displayCanvas: HTMLCanvasElement;
  currentAngle: number;
  animationFrame: number | null;
};

type ClockDisplayState = 'setup' | 'strategy' | 'playing' | 'ended';

const SEGMENTS: Record<string, number[]> = {
  '0': [1, 1, 1, 1, 1, 1, 0],
  '1': [0, 1, 1, 0, 0, 0, 0],
  '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1],
  '4': [0, 1, 1, 0, 0, 1, 1],
  '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1],
  '7': [1, 1, 1, 0, 0, 0, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
};

function secondsLabel(value: number): string {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function roundedMesh(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
  segments = 4,
): THREE.Mesh {
  const object = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, segments, radius), material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function addPlaneIcon(group: THREE.Group, shape: THREE.Shape, x: number, y: number, z: number, scale = 1): void {
  const material = new THREE.MeshBasicMaterial({ color: 0x1d2022, side: THREE.DoubleSide });
  const icon = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  icon.scale.setScalar(scale);
  icon.position.set(x, y, z);
  group.add(icon);
}

function triangleShape(direction: 'up' | 'down' | 'right'): THREE.Shape {
  const shape = new THREE.Shape();
  if (direction === 'right') {
    shape.moveTo(-0.08, -0.09); shape.lineTo(0.10, 0); shape.lineTo(-0.08, 0.09);
  } else if (direction === 'up') {
    shape.moveTo(-0.09, -0.06); shape.lineTo(0, 0.10); shape.lineTo(0.09, -0.06);
  } else {
    shape.moveTo(-0.09, 0.06); shape.lineTo(0, -0.10); shape.lineTo(0.09, 0.06);
  }
  shape.closePath();
  return shape;
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawDigit(
  ctx: CanvasRenderingContext2D,
  digit: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  const pattern = SEGMENTS[digit];
  if (!pattern) return;
  const t = Math.max(5, width * 0.105);
  const left = x + t * 0.65;
  const right = x + width - t * 0.65;
  const top = y + t * 0.65;
  const middle = y + height * 0.5;
  const bottom = y + height - t * 0.65;
  const upperA = y + t;
  const upperB = middle - t;
  const lowerA = middle + t;
  const lowerB = y + height - t;
  if (pattern[0]) drawSegment(ctx, left, top, right, top, t, color);
  if (pattern[1]) drawSegment(ctx, right, upperA, right, upperB, t, color);
  if (pattern[2]) drawSegment(ctx, right, lowerA, right, lowerB, t, color);
  if (pattern[3]) drawSegment(ctx, left, bottom, right, bottom, t, color);
  if (pattern[4]) drawSegment(ctx, left, lowerA, left, lowerB, t, color);
  if (pattern[5]) drawSegment(ctx, left, upperA, left, upperB, t, color);
  if (pattern[6]) drawSegment(ctx, left, middle, right, middle, t, color);
}

function drawClockValue(
  ctx: CanvasRenderingContext2D,
  value: number,
  x: number,
  y: number,
  width: number,
  color: string,
): void {
  const label = secondsLabel(value);
  const [minutes, seconds] = label.split(':');
  const minuteText = minutes.length > 1 ? minutes.slice(-2) : minutes;
  const characters = [...minuteText, ':', ...seconds];
  const digitWidth = minuteText.length > 1 ? 68 : 76;
  const digitHeight = 128;
  const gap = 10;
  const colonWidth = 24;
  const total = characters.reduce((sum, char) => sum + (char === ':' ? colonWidth : digitWidth), 0) + gap * (characters.length - 1);
  let cursor = x + (width - total) / 2;
  for (const char of characters) {
    if (char === ':') {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cursor + colonWidth / 2, y + 45, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cursor + colonWidth / 2, y + 92, 7, 0, Math.PI * 2); ctx.fill();
      cursor += colonWidth + gap;
    } else {
      drawDigit(ctx, char, cursor, y, digitWidth, digitHeight, color);
      cursor += digitWidth + gap;
    }
  }
}

function drawDisplay(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  whiteSeconds: number,
  blackSeconds: number,
  pendingSlap: ClockSide | null,
  state: ClockDisplayState,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#dbe1c7';
  ctx.fillRect(0, 0, w, h);

  if (pendingSlap === 'white') { ctx.fillStyle = 'rgba(88,150,105,.13)'; ctx.fillRect(0, 0, w * 0.45, h); }
  if (pendingSlap === 'black') { ctx.fillStyle = 'rgba(88,150,105,.13)'; ctx.fillRect(w * 0.55, 0, w * 0.45, h); }

  ctx.strokeStyle = 'rgba(34,40,39,.36)';
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.beginPath(); ctx.moveTo(w * 0.455, 12); ctx.lineTo(w * 0.455, h - 12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * 0.545, 12); ctx.lineTo(w * 0.545, h - 12); ctx.stroke();

  const digit = '#182027';
  drawClockValue(ctx, whiteSeconds, 20, 58, w * 0.42, digit);
  drawClockValue(ctx, blackSeconds, w * 0.56, 58, w * 0.42, digit);

  ctx.fillStyle = '#293238';
  ctx.font = '700 25px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('WHITE', w * 0.225, 36);
  ctx.fillText('BLACK', w * 0.775, 36);
  ctx.font = '800 23px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('QQURZ', w * 0.5, 56);
  ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(state === 'playing' ? (pendingSlap ? 'SLAP' : 'LIVE') : state.toUpperCase(), w * 0.5, 92);
  ctx.font = '700 17px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('bonus', w * 0.5, 132);
  ctx.beginPath(); ctx.arc(w * 0.5, 157, 6, 0, Math.PI * 2); ctx.fill();
  texture.needsUpdate = true;
}

function addButtonIcons(group: THREE.Group, buttonZ: number): void {
  addPlaneIcon(group, triangleShape('up'), -1.18, 0.35, buttonZ + 0.091, 1.05);
  addPlaneIcon(group, triangleShape('right'), 0.40, 0.35, buttonZ + 0.091, 0.92);
  addPlaneIcon(group, triangleShape('down'), 1.20, 0.35, buttonZ + 0.091, 1.05);

  const pauseMaterial = new THREE.MeshBasicMaterial({ color: 0x1d2022 });
  for (const x of [0.52, 0.60]) {
    const pause = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.16), pauseMaterial);
    pause.position.set(x, 0.35, buttonZ + 0.093);
    group.add(pause);
  }

  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x1d2022, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.095, 26, 1, 0.35, Math.PI * 1.55), ringMaterial);
  ring.position.set(-0.39, 0.35, buttonZ + 0.094);
  group.add(ring);
  addPlaneIcon(group, triangleShape('right'), -0.31, 0.41, buttonZ + 0.096, 0.42);
}

export function createChessClockModel(): ChessClockModel {
  const group = new THREE.Group();
  group.name = 'QQURZ tournament clock';

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.72, metalness: 0.02 });
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.78, metalness: 0.01 });
  const bezelMaterial = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.62, metalness: 0.03 });
  const rockerMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf1f2f2, roughness: 0.34, metalness: 0.02, clearcoat: 0.2, clearcoatRoughness: 0.45 });
  const buttonMaterial = new THREE.MeshPhysicalMaterial({ color: 0xeeeeec, roughness: 0.42, metalness: 0.02, clearcoat: 0.15 });
  const rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95 });

  const lower = roundedMesh(4.65, 0.34, 2.55, 0.22, baseMaterial, 5);
  lower.position.y = 0.18;
  group.add(lower);

  const body = roundedMesh(4.52, 1.18, 2.38, 0.30, bodyMaterial, 6);
  body.position.y = 0.79;
  group.add(body);

  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = 1024;
  displayCanvas.height = 240;
  const displayTexture = new THREE.CanvasTexture(displayCanvas);
  displayTexture.colorSpace = THREE.SRGBColorSpace;
  displayTexture.minFilter = THREE.LinearFilter;
  displayTexture.magFilter = THREE.LinearFilter;
  displayTexture.generateMipmaps = false;

  const bezel = roundedMesh(4.04, 0.74, 0.12, 0.085, bezelMaterial, 4);
  bezel.position.set(0, 0.78, 1.205);
  bezel.rotation.x = -0.035;
  group.add(bezel);

  const displayMaterial = new THREE.MeshBasicMaterial({ map: displayTexture, toneMapped: false });
  const display = new THREE.Mesh(new THREE.PlaneGeometry(3.82, 0.58), displayMaterial);
  display.position.set(0, 0.80, 1.274);
  display.rotation.x = -0.035;
  group.add(display);

  const buttonZ = 1.205;
  const buttonXs = [-1.18, -0.39, 0.40, 1.20];
  for (const x of buttonXs) {
    const button = roundedMesh(0.55, 0.22, 0.14, 0.055, buttonMaterial, 3);
    button.position.set(x, 0.35, buttonZ);
    button.rotation.x = -0.035;
    group.add(button);
  }
  addButtonIcons(group, buttonZ);

  const rocker = new THREE.Group();
  rocker.position.set(0, 1.47, -0.10);
  const rockerBody = roundedMesh(4.00, 0.23, 1.28, 0.18, rockerMaterial, 5);
  rockerBody.rotation.x = -0.055;
  rocker.add(rockerBody);
  const rockerInset = roundedMesh(4.16, 0.10, 1.43, 0.22, bezelMaterial, 4);
  rockerInset.position.y = -0.10;
  rockerInset.rotation.x = -0.055;
  rocker.add(rockerInset);
  rockerBody.renderOrder = 2;
  group.add(rocker);

  const brandCanvas = document.createElement('canvas');
  brandCanvas.width = 256; brandCanvas.height = 64;
  const brandCtx = brandCanvas.getContext('2d');
  if (brandCtx) {
    brandCtx.clearRect(0, 0, 256, 64);
    brandCtx.fillStyle = '#f4f5f5';
    brandCtx.textAlign = 'center';
    brandCtx.font = '800 30px -apple-system, BlinkMacSystemFont, sans-serif';
    brandCtx.fillText('QQURZ', 128, 40);
  }
  const brandTexture = new THREE.CanvasTexture(brandCanvas);
  brandTexture.colorSpace = THREE.SRGBColorSpace;
  brandTexture.generateMipmaps = false;
  const brand = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.18), new THREE.MeshBasicMaterial({ map: brandTexture, transparent: true, toneMapped: false }));
  brand.position.set(0, 1.205, 1.23);
  brand.rotation.x = -0.035;
  group.add(brand);

  const footPositions: Array<[number, number]> = [[-1.75, -0.86], [1.75, -0.86], [-1.75, 0.86], [1.75, 0.86]];
  for (const [x, z] of footPositions) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.09, 24), rubberMaterial);
    foot.position.set(x, -0.035, z);
    foot.castShadow = true;
    group.add(foot);
  }

  const batteryDoor = roundedMesh(1.82, 0.045, 1.05, 0.07, baseMaterial, 3);
  batteryDoor.position.set(0, 0.02, -0.23);
  group.add(batteryDoor);

  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hitMeshes: THREE.Mesh[] = [];
  for (const [side, x] of [['white', -1.0], ['black', 1.0]] as const) {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.48, 1.45), hitMaterial);
    hit.position.set(x, 1.48, -0.10);
    hit.userData.clockSide = side;
    hitMeshes.push(hit);
    group.add(hit);
  }

  drawDisplay(displayCanvas, displayTexture, 600, 600, null, 'setup');
  return { group, rocker, hitMeshes, displayTexture, displayCanvas, currentAngle: 0, animationFrame: null };
}

export function updateChessClockModel(
  model: ChessClockModel,
  whiteSeconds: number,
  blackSeconds: number,
  pendingSlap: ClockSide | null,
  state: ClockDisplayState,
): void {
  drawDisplay(model.displayCanvas, model.displayTexture, whiteSeconds, blackSeconds, pendingSlap, state);
}

export function animateChessClockRocker(
  model: ChessClockModel,
  side: ClockSide,
  render: () => void,
): void {
  if (model.animationFrame !== null) cancelAnimationFrame(model.animationFrame);
  const start = performance.now();
  const from = model.currentAngle;
  const target = side === 'white' ? 0.075 : -0.075;
  const duration = 150;
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const overshoot = Math.sin(Math.PI * t) * target * 0.22;
    const angle = from + (target - from) * eased + overshoot;
    model.currentAngle = angle;
    model.rocker.rotation.z = angle;
    render();
    if (t < 1) model.animationFrame = requestAnimationFrame(frame);
    else {
      model.currentAngle = target;
      model.rocker.rotation.z = target;
      model.animationFrame = null;
      render();
    }
  };
  model.animationFrame = requestAnimationFrame(frame);
}

export function disposeChessClockModel(model: ChessClockModel): void {
  if (model.animationFrame !== null) cancelAnimationFrame(model.animationFrame);
  model.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    }
  });
  model.displayTexture.dispose();
}
