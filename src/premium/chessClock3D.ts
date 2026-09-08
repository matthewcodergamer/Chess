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

const CLOCK_ENABLED_KEY = 'qqurz:3d-clock-enabled';
const CLOCK_VISIBILITY_EVENT = 'qqurz:clock-visibility';

// YS-902/reference clock: 140 x 88 x 45 mm. The scene model uses the same
// 140:88:45 proportions so it reads as the real wedge-shaped clock rather
// than a flat front panel.
const REAL_MM = { width: 140, depth: 88, height: 45 } as const;
const MODEL_WIDTH = 4.20;
const MODEL_DEPTH = MODEL_WIDTH * REAL_MM.depth / REAL_MM.width;
const MODEL_HEIGHT = MODEL_WIDTH * REAL_MM.height / REAL_MM.width;

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

function clockEnabled() {
  try { return window.localStorage.getItem(CLOCK_ENABLED_KEY) !== 'off'; } catch { return true; }
}

function fmt(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function rounded(width: number, height: number, depth: number, radius: number, material: THREE.Material, segments = 5) {
  const geometry = new RoundedBoxGeometry(width, height, depth, segments, radius);
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function groovedRocker(width: number, height: number, depth: number, radius: number, material: THREE.Material) {
  const geometry = new RoundedBoxGeometry(width, height, depth, 9, radius);
  const positions = geometry.attributes.position;
  const halfWidth = width * .5;
  const halfDepth = depth * .5;

  // The reference has a shallow ergonomic valley through the large white
  // rocker. Sculpt it into the mesh itself: it is genuine 3D geometry, not a
  // painted/2D groove.
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const nx = Math.min(1, Math.abs(x) / halfWidth);
    const nz = Math.min(1, Math.abs(z) / halfDepth);
    const centre = Math.pow(1 - nx * nx, 1.55) * (.76 + .24 * (1 - nz));
    positions.setY(i, positions.getY(i) - .085 * centre);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function segmentRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, on: boolean) {
  ctx.fillStyle = on ? '#17202c' : 'rgba(23,32,44,.065)';
  const cut = Math.min(w, h) * .28;
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
      ctx.fillStyle = '#17202c';
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

function setLed(material: THREE.MeshPhysicalMaterial, on: boolean, pending: boolean) {
  material.color.setHex(on ? 0x4fe68a : 0x183023);
  material.emissive.setHex(on ? 0x20c868 : 0x07150d);
  material.emissiveIntensity = on ? (pending ? 3.6 : 2.35) : .16;
}

export function createChessClock3D(): ChessClock3DModel {
  const group = new THREE.Group();
  group.name = 'qqurzReferenceTournamentClock';
  group.visible = clockEnabled();

  // PremiumBoard3D historically placed its clock to the left. Keep its public
  // scene API stable while relocating the physical assembly to the centre/front
  // (the visual bottom of the board) and counter-rotating the old parent angle.
  // This avoids dragging Three.js changes into the fast 2D route.
  const assembly = new THREE.Group();
  assembly.name = 'qqurzClockPhysicalAssembly';
  assembly.position.set(6.735, 0, 6.40);
  assembly.rotation.y = -.035;
  group.add(assembly);

  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x111315, roughness: .67, metalness: .012, clearcoat: .08, clearcoatRoughness: .72 });
  const shoulderMat = new THREE.MeshPhysicalMaterial({ color: 0x181a1c, roughness: .69, metalness: .01, clearcoat: .06, clearcoatRoughness: .77 });
  const lowerMat = new THREE.MeshStandardMaterial({ color: 0x070809, roughness: .82 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x020304, roughness: .58 });
  const whitePlastic = new THREE.MeshPhysicalMaterial({ color: 0xf5f6f7, roughness: .30, metalness: .012, clearcoat: .30, clearcoatRoughness: .34 });
  const iconMat = new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: .58 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: .98 });
  const ledWhiteMat = new THREE.MeshPhysicalMaterial({ color: 0x183023, emissive: 0x07150d, emissiveIntensity: .16, roughness: .22, clearcoat: .8 });
  const ledBlackMat = ledWhiteMat.clone();

  // Keep the outer envelope faithful to 140 x 88 x 45 mm.
  const lower = rounded(MODEL_WIDTH, .29, MODEL_DEPTH, .18, lowerMat, 7);
  lower.position.y = .145;
  assembly.add(lower);

  const body = rounded(MODEL_WIDTH - .10, .73, MODEL_DEPTH - .08, .30, bodyMat, 8);
  body.position.set(0, .54, .01);
  assembly.add(body);

  // Sloped upper shoulder gives the distinctive wedge side profile.
  const shoulder = rounded(MODEL_WIDTH - .34, .38, MODEL_DEPTH - .34, .25, shoulderMat, 8);
  shoulder.position.set(0, .94, -.12);
  shoulder.rotation.x = -.055;
  assembly.add(shoulder);

  const rockerWell = rounded(MODEL_WIDTH - .63, .13, MODEL_DEPTH - .69, .21, bezelMat, 8);
  rockerWell.position.set(0, 1.105, -.18);
  rockerWell.rotation.x = -.055;
  assembly.add(rockerWell);

  const rocker = groovedRocker(MODEL_WIDTH - .80, .235, MODEL_DEPTH - .88, .18, whitePlastic);
  rocker.position.set(0, 1.215, -.18);
  rocker.rotation.x = -.055;
  rocker.userData.clockRocker = true;
  assembly.add(rocker);

  // A very subtle highlight follows the sculpted groove but does not fake its depth.
  const grooveMaterial = new THREE.MeshBasicMaterial({ color: 0xbcc0c5, transparent: true, opacity: .12, depthWrite: false });
  const groove = new THREE.Mesh(new THREE.PlaneGeometry(.96, .020), grooveMaterial);
  groove.rotation.x = -Math.PI / 2;
  groove.position.set(0, 1.316, -.18);
  assembly.add(groove);

  // Real display window is about 103 x 23 mm: preserve its width/height ratio.
  const bezel = rounded(3.31, .64, .13, .08, bezelMat, 6);
  bezel.position.set(0, .61, MODEL_DEPTH * .5 - .055);
  bezel.rotation.x = -.035;
  assembly.add(bezel);

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
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(3.09, .50), lcdMat);
  lcd.position.set(0, .64, MODEL_DEPTH * .5 + .018);
  lcd.rotation.x = -.035;
  assembly.add(lcd);

  const frontZ = MODEL_DEPTH * .5 + .017;
  const buttonXs = [-.98, -.327, .327, .98];
  for (const x of buttonXs) {
    const button = rounded(.49, .18, .13, .052, whitePlastic, 5);
    button.position.set(x, .255, frontZ - .010);
    button.rotation.x = -.035;
    assembly.add(button);
  }
  addTriangle(assembly, iconMat, -.98, .266, frontZ + .060, false);
  const resetRing = new THREE.Mesh(new THREE.TorusGeometry(.067, .014, 10, 26), iconMat);
  resetRing.position.set(-.327, .266, frontZ + .060);
  assembly.add(resetRing);
  addTriangle(assembly, iconMat, .286, .266, frontZ + .060, false);
  const pause1 = new THREE.Mesh(new THREE.BoxGeometry(.023, .108, .012), iconMat);
  pause1.position.set(.37, .266, frontZ + .062);
  assembly.add(pause1);
  const pause2 = pause1.clone(); pause2.position.x = .41; assembly.add(pause2);
  addTriangle(assembly, iconMat, .98, .266, frontZ + .060, true);

  // Two physical green status LEDs: one for each player. The currently running
  // side glows, and the side waiting to be slapped glows brighter.
  for (const [x, mat, color] of [[-1.69, ledWhiteMat, 'white'], [1.69, ledBlackMat, 'black']] as const) {
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, .026, 24), bezelMat);
    socket.rotation.x = Math.PI / 2;
    socket.position.set(x, .93, frontZ - .03);
    assembly.add(socket);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(.053, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    lens.rotation.x = -Math.PI / 2;
    lens.position.set(x, .93, frontZ + .005);
    lens.userData.turnLed = color;
    assembly.add(lens);
  }

  const seam = new THREE.Mesh(new THREE.BoxGeometry(MODEL_WIDTH - .40, .014, MODEL_DEPTH - .22), new THREE.MeshBasicMaterial({ color: 0x020202 }));
  seam.position.set(0, .29, .02);
  assembly.add(seam);

  for (const [x, z] of [[-1.66, -.94], [1.66, -.94], [-1.66, .94], [1.66, .94]] as const) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.11, .12, .07, 22), footMat);
    foot.position.set(x, .012, z);
    foot.castShadow = true;
    assembly.add(foot);
  }

  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(3.72, .52, 1.72), hitMaterial);
  hit.position.set(0, 1.22, -.18);
  hit.userData.clockRocker = true;
  assembly.add(hit);

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

    setLed(ledWhiteMat, activeColor === 'white', pendingSlap === 'white');
    setLed(ledBlackMat, activeColor === 'black', pendingSlap === 'black');

    ctx.fillStyle = '#dbe1cd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = activeColor === 'white' ? 'rgba(52,125,77,.12)' : 'rgba(255,255,255,.03)';
    ctx.fillRect(0, 0, 430, 230);
    ctx.fillStyle = activeColor === 'black' ? 'rgba(52,125,77,.12)' : 'rgba(255,255,255,.03)';
    ctx.fillRect(594, 0, 430, 230);
    ctx.strokeStyle = 'rgba(28,37,32,.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 1016, 222);
    ctx.beginPath();
    ctx.moveTo(500, 8); ctx.lineTo(500, 220);
    ctx.moveTo(524, 8); ctx.lineTo(524, 220);
    ctx.stroke();

    drawTime(ctx, fmt(whiteSeconds), 30, 35, 390, 142);
    drawTime(ctx, fmt(blackSeconds), 604, 35, 390, 142);
    ctx.fillStyle = '#17202c';
    ctx.font = '700 23px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('03', 512, 48);
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText('bonus', 512, 122);
    ctx.beginPath(); ctx.arc(555, 116, 6, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left'; ctx.fillText('000', 354, 28);
    ctx.textAlign = 'right'; ctx.fillText('000', 670, 28);
    if (pendingSlap) {
      ctx.fillStyle = 'rgba(23,32,44,.72)';
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${pendingSlap.toUpperCase()} PRESS`, 512, 203);
    }
    texture.needsUpdate = true;
  };

  const slap = (color: Color) => {
    // A real rocker pivots rather than translating as a flat button.
    rocker.rotation.z = color === 'white' ? -.075 : .075;
    rocker.position.y = 1.197;
  };

  const visibility = (event: Event) => {
    const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
    group.visible = typeof detail?.enabled === 'boolean' ? detail.enabled : clockEnabled();
  };
  window.addEventListener(CLOCK_VISIBILITY_EVENT, visibility);

  const dispose = () => {
    window.removeEventListener(CLOCK_VISIBILITY_EVENT, visibility);
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
