import type { Color } from '@lichess-org/chessground/types';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type ChessClock3DModel = {
  group: THREE.Group;
  rocker: THREE.Mesh;
  hitTargets: THREE.Object3D[];
  update: (whiteSeconds: number, blackSeconds: number, activeColor?: Color | null, pendingSlap?: Color | null) => void;
  slap: (color: Color) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
};

// The supplied reference follows the compact LEAP/PQ9907S-style wedge chassis.
// Published dimensions for that family are about 132 × 114 × 36 mm
// (5.2 × 4.5 × 1.4 in). The four front controls are taken from the user's
// supplied reference, while the chassis/rocker proportions use those real-world dimensions.
const CLOCK_MM = { width: 132, depth: 114, height: 36 } as const;
const CLOCK_W = 3.96;
const CLOCK_D = CLOCK_W * (CLOCK_MM.depth / CLOCK_MM.width);
const CLOCK_H = CLOCK_W * (CLOCK_MM.height / CLOCK_MM.width);
const FRONT_Z = CLOCK_D * .5;

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

function rounded(width: number, height: number, depth: number, radius: number, material: THREE.Material, segments = 7) {
  const geometry = new RoundedBoxGeometry(width, height, depth, segments, radius);
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function curvedRocker(material: THREE.Material) {
  const width = 3.30;
  const height = .21;
  const depth = 2.34;
  const geometry = new RoundedBoxGeometry(width, height, depth, 10, .17);
  const positions = geometry.attributes.position;
  const halfWidth = width * .5;
  const halfDepth = depth * .5;

  // The physical rocker is a three-dimensional saddle, not a flat white plate.
  // Dip the middle, retain thick rounded shoulders and slightly raise the rear edge.
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const nx = Math.min(1, Math.abs(x) / halfWidth);
    const nz = Math.min(1, Math.abs(z) / halfDepth);
    const centre = Math.pow(1 - nx * nx, 1.35) * (.72 + .28 * (1 - nz));
    const rearLift = THREE.MathUtils.clamp((-z / halfDepth) * .018, -.018, .018);
    positions.setY(i, positions.getY(i) - .070 * centre + rearLift);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const rocker = new THREE.Mesh(geometry, material);
  rocker.castShadow = true;
  rocker.receiveShadow = true;
  return rocker;
}

function segmentRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, on: boolean) {
  ctx.fillStyle = on ? '#17202c' : 'rgba(23,32,44,.058)';
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

function addRearDetails(group: THREE.Group, dark: THREE.Material, rubber: THREE.Material) {
  // Battery door and latch on the back/bottom so rotating the scene still shows a complete object.
  const door = rounded(1.70, .055, 1.18, .08, dark, 5);
  door.position.set(0, .075, -1.03);
  door.rotation.x = -.02;
  group.add(door);

  const latch = rounded(.34, .10, .18, .04, rubber, 4);
  latch.position.set(0, .13, -1.61);
  group.add(latch);

  const switchWell = rounded(.38, .12, .22, .045, dark, 4);
  switchWell.position.set(-1.30, .20, -1.47);
  group.add(switchWell);
  const slider = rounded(.14, .13, .11, .028, rubber, 3);
  slider.position.set(-1.34, .235, -1.56);
  group.add(slider);

  // Small speaker perforations visible from the rear three-quarter angle.
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .025, 12), rubber);
      dot.rotation.x = Math.PI / 2;
      dot.position.set(1.12 + col * .12, .28 + row * .105, -1.61);
      group.add(dot);
    }
  }
}

export function createChessClock3D(): ChessClock3DModel {
  const group = new THREE.Group();
  group.name = 'qqurzReferenceTournamentClock3D';
  group.userData.dimensionsMm = { ...CLOCK_MM };

  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x111315, roughness: .63, metalness: .012, clearcoat: .08, clearcoatRoughness: .72 });
  const shoulderMat = new THREE.MeshPhysicalMaterial({ color: 0x181a1c, roughness: .68, metalness: .01, clearcoat: .06, clearcoatRoughness: .77 });
  const lowerMat = new THREE.MeshStandardMaterial({ color: 0x070809, roughness: .82 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x020304, roughness: .55 });
  const whitePlastic = new THREE.MeshPhysicalMaterial({ color: 0xf6f7f8, roughness: .30, metalness: .01, clearcoat: .34, clearcoatRoughness: .33 });
  const iconMat = new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: .58 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: .97 });
  const rearDetailMat = new THREE.MeshStandardMaterial({ color: 0x0d0f10, roughness: .86 });
  const inactiveLed = 0x173126;
  const ledOn = 0x59f29a;
  const leftLedMat = new THREE.MeshStandardMaterial({ color: inactiveLed, emissive: ledOn, emissiveIntensity: 0, roughness: .28 });
  const rightLedMat = leftLedMat.clone();

  // Low rounded base.
  const lower = rounded(CLOCK_W, .26, CLOCK_D, .18, lowerMat, 8);
  lower.position.y = .13;
  group.add(lower);

  // Main chassis. Keeping the body full-depth gives genuine side/rear volume rather than a 2D facade.
  const body = rounded(CLOCK_W - .10, .58, CLOCK_D - .10, .27, bodyMat, 9);
  body.position.set(0, .43, .015);
  group.add(body);

  // Raised rear/top shoulder creates the real wedge silhouette from the supplied side view.
  const shoulder = rounded(CLOCK_W - .36, .36, CLOCK_D - .42, .23, shoulderMat, 9);
  shoulder.position.set(0, .76, -.24);
  shoulder.rotation.x = -.075;
  group.add(shoulder);

  // Deep tray and fully volumetric seesaw rocker.
  const rockerWell = rounded(3.52, .13, 2.57, .20, bezelMat, 9);
  rockerWell.position.set(0, .89, -.26);
  rockerWell.rotation.x = -.075;
  group.add(rockerWell);

  const rocker = curvedRocker(whitePlastic);
  rocker.position.set(0, 1.01, -.26);
  rocker.rotation.x = -.075;
  rocker.userData.clockRocker = true;
  group.add(rocker);

  // A faint centre saddle line makes the curved rocker readable on an iPhone without flattening it.
  const grooveMat = new THREE.MeshBasicMaterial({ color: 0xbfc4ca, transparent: true, opacity: .20, depthWrite: false });
  const groove = new THREE.Mesh(new THREE.PlaneGeometry(.82, .025), grooveMat);
  groove.rotation.x = -Math.PI / 2;
  groove.position.set(0, 1.105, -.27);
  group.add(groove);

  // Deep front bezel and live LCD.
  const bezel = rounded(3.42, .55, .15, .078, bezelMat, 6);
  bezel.position.set(0, .50, FRONT_Z - .03);
  bezel.rotation.x = -.035;
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
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(3.18, .45), lcdMat);
  lcd.position.set(0, .515, FRONT_Z + .052);
  lcd.rotation.x = -.035;
  group.add(lcd);

  // Four front keys from the supplied black/white reference.
  const buttonXs = [-.98, -.33, .33, .98];
  for (const x of buttonXs) {
    const button = rounded(.47, .16, .15, .052, whitePlastic, 5);
    button.position.set(x, .205, FRONT_Z + .015);
    button.rotation.x = -.035;
    group.add(button);
  }
  addTriangle(group, iconMat, -.98, .216, FRONT_Z + .097, false);
  const resetRing = new THREE.Mesh(new THREE.TorusGeometry(.064, .014, 10, 24), iconMat);
  resetRing.position.set(-.33, .216, FRONT_Z + .097); group.add(resetRing);
  addTriangle(group, iconMat, .288, .216, FRONT_Z + .097, false);
  const pause1 = new THREE.Mesh(new THREE.BoxGeometry(.022, .104, .012), iconMat);
  pause1.position.set(.374, .216, FRONT_Z + .099); group.add(pause1);
  const pause2 = pause1.clone(); pause2.position.x = .410; group.add(pause2);
  addTriangle(group, iconMat, .98, .216, FRONT_Z + .097, true);

  // Green turn-ready lamps: left = White, right = Black. One glows for the active/pressing side.
  const ledGeometry = new THREE.SphereGeometry(.062, 20, 12);
  const leftLed = new THREE.Mesh(ledGeometry, leftLedMat);
  leftLed.scale.z = .48; leftLed.position.set(-1.55, .215, FRONT_Z + .09); group.add(leftLed);
  const rightLed = new THREE.Mesh(ledGeometry.clone(), rightLedMat);
  rightLed.scale.z = .48; rightLed.position.set(1.55, .215, FRONT_Z + .09); group.add(rightLed);

  // Case seam and rubber feet.
  const seam = new THREE.Mesh(new THREE.BoxGeometry(3.58, .014, CLOCK_D - .27), new THREE.MeshBasicMaterial({ color: 0x020202 }));
  seam.position.set(0, .25, .01); group.add(seam);
  for (const [x, z] of [[-1.62, -1.25], [1.62, -1.25], [-1.62, 1.25], [1.62, 1.25]] as const) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.105, .115, .065, 20), footMat);
    foot.position.set(x, .012, z); foot.castShadow = true; group.add(foot);
  }
  addRearDetails(group, rearDetailMat, footMat);

  // Large invisible touch target stays three-dimensional and follows the rocker volume.
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(3.66, .52, 2.72), hitMaterial);
  hit.position.set(0, 1.03, -.26); hit.rotation.x = -.075; hit.userData.clockRocker = true; group.add(hit);

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
    const setLed = (mat: THREE.MeshStandardMaterial, on: boolean) => {
      mat.color.setHex(on ? ledOn : inactiveLed);
      mat.emissive.setHex(ledOn);
      mat.emissiveIntensity = on ? 2.8 : .025;
    };
    setLed(leftLedMat, lit === 'white');
    setLed(rightLedMat, lit === 'black');

    ctx.fillStyle = '#dce2cf';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = lit === 'white' ? 'rgba(58,143,83,.15)' : 'rgba(255,255,255,.045)'; ctx.fillRect(0, 0, 430, 230);
    ctx.fillStyle = lit === 'black' ? 'rgba(58,143,83,.15)' : 'rgba(255,255,255,.045)'; ctx.fillRect(594, 0, 430, 230);
    ctx.strokeStyle = 'rgba(28,37,32,.27)'; ctx.lineWidth = 3; ctx.strokeRect(4, 4, 1016, 222);
    ctx.beginPath(); ctx.moveTo(500, 8); ctx.lineTo(500, 220); ctx.moveTo(524, 8); ctx.lineTo(524, 220); ctx.stroke();

    drawTime(ctx, fmt(whiteSeconds), 30, 35, 390, 142);
    drawTime(ctx, fmt(blackSeconds), 604, 35, 390, 142);
    ctx.fillStyle = '#17202c';
    ctx.font = '700 23px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.fillText('03', 512, 48);
    ctx.font = '600 18px system-ui, sans-serif'; ctx.fillText('bonus', 512, 122);
    ctx.beginPath(); ctx.arc(555, 116, 6, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left'; ctx.fillText('000', 354, 28);
    ctx.textAlign = 'right'; ctx.fillText('000', 670, 28);
    if (pendingSlap) {
      ctx.fillStyle = 'rgba(23,32,44,.70)';
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(`${pendingSlap.toUpperCase()} PRESS`, 512, 203);
    }
    texture.needsUpdate = true;
  };

  const slap = (color: Color) => {
    // A real seesaw remains tipped toward the side just pressed.
    rocker.rotation.z = color === 'white' ? -.073 : .073;
    rocker.position.y = .992;
  };

  const setVisible = (visible: boolean) => { group.visible = visible; };

  const dispose = () => {
    const seenMaterials = new Set<THREE.Material>();
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (seenMaterials.has(material)) continue;
        seenMaterials.add(material);
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        material.dispose();
      }
    });
  };

  update(600, 600, 'white', null);
  return { group, rocker, hitTargets: [hit], update, slap, setVisible, dispose };
}
