import type { Color } from '@lichess-org/chessground/types';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type ChessClock3DModel = {
  group: THREE.Group;
  rocker: THREE.Mesh;
  hitTargets: THREE.Object3D[];
  update: (whiteSeconds: number, blackSeconds: number, activeColor?: Color | null, pendingSlap?: Color | null) => void;
  slap: (color: Color) => void;
  dispose: () => void;
};

// Reference scale: 50 mm = one scene unit. A current tournament clock is
// approximately 198 × 110 × 60 mm, so the model is built around 3.96 × 2.20 × 1.20.
// The supplied black-clock reference is used for the shell/rocker silhouette.
const CLOCK_W = 3.96;
const CLOCK_D = 2.20;
const CLOCK_H = 1.20;

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

function fmt(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function rounded(width: number, height: number, depth: number, radius: number, material: THREE.Material, segments = 6) {
  const geometry = new RoundedBoxGeometry(width, height, depth, segments, radius);
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function curvedRocker(material: THREE.Material) {
  const width = 3.18;
  const height = .22;
  const depth = 1.16;
  const geometry = new RoundedBoxGeometry(width, height, depth, 9, .17);
  const positions = geometry.attributes.position;
  const halfWidth = width * .5;
  const halfDepth = depth * .5;

  // Create the shallow hand-shaped saddle visible in the physical reference.
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const nx = Math.min(1, Math.abs(x) / halfWidth);
    const nz = Math.min(1, Math.abs(z) / halfDepth);
    const centre = Math.pow(1 - nx * nx, 1.35) * (.72 + .28 * (1 - nz));
    positions.setY(i, positions.getY(i) - .066 * centre);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const rocker = new THREE.Mesh(geometry, material);
  rocker.castShadow = true;
  rocker.receiveShadow = true;
  return rocker;
}

function segmentRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, on: boolean) {
  ctx.fillStyle = on ? '#18212e' : 'rgba(24,33,46,.060)';
  const cut = Math.min(w, h) * .27;
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();
  ctx.fill();
}

function drawDigit(ctx: CanvasRenderingContext2D, digit: string, x: number, y: number, w: number, h: number) {
  const on = SEGMENTS[digit] ?? [0, 0, 0, 0, 0, 0, 0];
  const t = Math.max(4, w * .13);
  const half = h / 2;
  segmentRect(ctx, x + t, y, w - 2 * t, t, Boolean(on[0]));
  segmentRect(ctx, x + w - t, y + t, t, half - 1.5 * t, Boolean(on[1]));
  segmentRect(ctx, x + w - t, y + half + .5 * t, t, half - 1.5 * t, Boolean(on[2]));
  segmentRect(ctx, x + t, y + h - t, w - 2 * t, t, Boolean(on[3]));
  segmentRect(ctx, x, y + half + .5 * t, t, half - 1.5 * t, Boolean(on[4]));
  segmentRect(ctx, x, y + t, t, half - 1.5 * t, Boolean(on[5]));
  segmentRect(ctx, x + t, y + half - t / 2, w - 2 * t, t, Boolean(on[6]));
}

function drawTime(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, height: number) {
  const chars = value.split('');
  const gap = 7;
  const colonW = 17;
  const digitCount = chars.filter(char => char !== ':').length;
  const digitW = (width - colonW - gap * (chars.length - 1)) / digitCount;
  let cx = x;
  for (const char of chars) {
    if (char === ':') {
      ctx.fillStyle = '#18212e';
      ctx.beginPath(); ctx.arc(cx + colonW / 2, y + height * .36, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + colonW / 2, y + height * .66, 5, 0, Math.PI * 2); ctx.fill();
      cx += colonW + gap;
    } else {
      drawDigit(ctx, char, cx, y, digitW, height);
      cx += digitW + gap;
    }
  }
}

function addTriangle(group: THREE.Group, material: THREE.Material, x: number, y: number, z: number, down = false) {
  const shape = new THREE.Shape();
  shape.moveTo(0, down ? -.07 : .07);
  shape.lineTo(-.075, down ? .06 : -.06);
  shape.lineTo(.075, down ? .06 : -.06);
  shape.closePath();
  const icon = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  icon.position.set(x, y, z);
  group.add(icon);
}

export function createChessClock3D(): ChessClock3DModel {
  const group = new THREE.Group();
  group.name = 'qqurzSharedTournamentClock3D';
  group.userData.dimensionsMm = { width: 198, depth: 110, height: 60 };

  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x111315, roughness: .62, metalness: .012, clearcoat: .09, clearcoatRoughness: .70 });
  const shoulderMat = new THREE.MeshPhysicalMaterial({ color: 0x17191b, roughness: .66, metalness: .01, clearcoat: .07, clearcoatRoughness: .75 });
  const lowerMat = new THREE.MeshStandardMaterial({ color: 0x070809, roughness: .80 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x020304, roughness: .55 });
  const whitePlastic = new THREE.MeshPhysicalMaterial({ color: 0xf5f6f7, roughness: .30, metalness: .01, clearcoat: .33, clearcoatRoughness: .34 });
  const iconMat = new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: .58 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: .97 });
  const inactiveLed = 0x173126;
  const leftLedMat = new THREE.MeshStandardMaterial({ color: inactiveLed, emissive: 0x28d879, emissiveIntensity: 0, roughness: .34 });
  const rightLedMat = leftLedMat.clone();

  // Low base + high rear shoulder produces the tapered wedge profile from the side.
  const lower = rounded(CLOCK_W, .30, CLOCK_D, .18, lowerMat, 7);
  lower.position.y = .15;
  group.add(lower);

  const body = rounded(CLOCK_W - .12, .70, CLOCK_D - .10, .28, bodyMat, 8);
  body.position.set(0, .53, .015);
  group.add(body);

  const shoulder = rounded(CLOCK_W - .42, .40, CLOCK_D - .35, .24, shoulderMat, 8);
  shoulder.position.set(0, .89, -.15);
  shoulder.rotation.x = -.045;
  group.add(shoulder);

  const rockerWell = rounded(3.38, .13, 1.32, .21, bezelMat, 8);
  rockerWell.position.set(0, 1.04, -.17);
  rockerWell.rotation.x = -.045;
  group.add(rockerWell);

  const rocker = curvedRocker(whitePlastic);
  rocker.position.set(0, 1.155, -.17);
  rocker.rotation.x = -.045;
  rocker.userData.clockRocker = true;
  group.add(rocker);

  // Front LCD and its deep black bezel.
  const bezel = rounded(3.35, .62, .13, .078, bezelMat, 6);
  bezel.position.set(0, .61, 1.035);
  bezel.rotation.x = -.028;
  group.add(bezel);

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 230;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is required for the chess clock LCD.');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const lcdMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(3.13, .51), lcdMat);
  lcd.position.set(0, .625, 1.107);
  lcd.rotation.x = -.028;
  group.add(lcd);

  // Four small front controls, matching the supplied reference.
  const buttonXs = [-.97, -.325, .325, .97];
  for (const x of buttonXs) {
    const button = rounded(.48, .17, .13, .052, whitePlastic, 5);
    button.position.set(x, .255, 1.065);
    button.rotation.x = -.028;
    group.add(button);
  }
  addTriangle(group, iconMat, -.97, .266, 1.137, false);
  const resetRing = new THREE.Mesh(new THREE.TorusGeometry(.064, .014, 10, 24), iconMat);
  resetRing.position.set(-.325, .266, 1.137); group.add(resetRing);
  addTriangle(group, iconMat, .285, .266, 1.137, false);
  const pause1 = new THREE.Mesh(new THREE.BoxGeometry(.022, .105, .012), iconMat);
  pause1.position.set(.37, .266, 1.139); group.add(pause1);
  const pause2 = pause1.clone(); pause2.position.x = .407; group.add(pause2);
  addTriangle(group, iconMat, .97, .266, 1.137, true);

  // Turn-ready lamps requested for the digital version. Only one emits green at a time.
  const ledGeometry = new THREE.CylinderGeometry(.055, .055, .025, 24);
  const leftLed = new THREE.Mesh(ledGeometry, leftLedMat);
  leftLed.rotation.x = Math.PI / 2; leftLed.position.set(-1.53, .255, 1.137); group.add(leftLed);
  const rightLed = new THREE.Mesh(ledGeometry.clone(), rightLedMat);
  rightLed.rotation.x = Math.PI / 2; rightLed.position.set(1.53, .255, 1.137); group.add(rightLed);

  const seam = new THREE.Mesh(new THREE.BoxGeometry(3.55, .014, 1.89), new THREE.MeshBasicMaterial({ color: 0x020202 }));
  seam.position.set(0, .29, .015); group.add(seam);

  for (const [x, z] of [[-1.62, -.80], [1.62, -.80], [-1.62, .80], [1.62, .80]] as const) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.105, .115, .065, 20), footMat);
    foot.position.set(x, .012, z); foot.castShadow = true; group.add(foot);
  }

  // Generous invisible target keeps the real 3D rocker easy to slap on iPhone.
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(3.56, .50, 1.46), hitMaterial);
  hit.position.set(0, 1.18, -.17); hit.userData.clockRocker = true; group.add(hit);

  let lastWhite = -1;
  let lastBlack = -1;
  let lastActive: Color | null | undefined;
  let lastPending: Color | null | undefined;

  const update = (whiteSeconds: number, blackSeconds: number, activeColor?: Color | null, pendingSlap?: Color | null) => {
    const white = Math.ceil(whiteSeconds);
    const black = Math.ceil(blackSeconds);
    if (white === lastWhite && black === lastBlack && activeColor === lastActive && pendingSlap === lastPending) return;
    lastWhite = white;
    lastBlack = black;
    lastActive = activeColor;
    lastPending = pendingSlap;

    const lit = pendingSlap ?? activeColor ?? null;
    leftLedMat.emissiveIntensity = lit === 'white' ? 3.1 : 0;
    rightLedMat.emissiveIntensity = lit === 'black' ? 3.1 : 0;
    leftLedMat.color.setHex(lit === 'white' ? 0x64efa6 : inactiveLed);
    rightLedMat.color.setHex(lit === 'black' ? 0x64efa6 : inactiveLed);

    ctx.fillStyle = '#dce2cf';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = lit === 'white' ? 'rgba(56,139,81,.16)' : 'rgba(255,255,255,.045)'; ctx.fillRect(0, 0, 430, 230);
    ctx.fillStyle = lit === 'black' ? 'rgba(56,139,81,.16)' : 'rgba(255,255,255,.045)'; ctx.fillRect(594, 0, 430, 230);
    ctx.strokeStyle = 'rgba(28,37,32,.28)'; ctx.lineWidth = 3; ctx.strokeRect(4, 4, 1016, 222);
    ctx.beginPath(); ctx.moveTo(500, 8); ctx.lineTo(500, 220); ctx.moveTo(524, 8); ctx.lineTo(524, 220); ctx.stroke();

    drawTime(ctx, fmt(whiteSeconds), 30, 35, 390, 142);
    drawTime(ctx, fmt(blackSeconds), 604, 35, 390, 142);
    ctx.fillStyle = '#18212e';
    ctx.font = '700 23px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'center'; ctx.fillText('03', 512, 48);
    ctx.font = '600 18px system-ui, sans-serif'; ctx.fillText('bonus', 512, 122);
    ctx.beginPath(); ctx.arc(555, 116, 6, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'left'; ctx.fillText('000', 354, 28); ctx.textAlign = 'right'; ctx.fillText('000', 670, 28);
    if (pendingSlap) {
      ctx.fillStyle = 'rgba(24,33,46,.72)'; ctx.font = '800 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${pendingSlap.toUpperCase()} PRESS`, 512, 203);
    }
    texture.needsUpdate = true;
  };

  const slap = (color: Color) => {
    rocker.rotation.z = color === 'white' ? -.072 : .072;
    rocker.position.y = 1.142;
  };

  const dispose = () => {
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        material.dispose();
      }
    });
  };

  update(600, 600, 'white', null);
  return { group, rocker, hitTargets: [hit], update, slap, dispose };
}
