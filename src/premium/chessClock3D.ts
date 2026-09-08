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

function rounded(width: number, height: number, depth: number, radius: number, material: THREE.Material, segments = 5) {
  const geometry = new RoundedBoxGeometry(width, height, depth, segments, radius);
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function groovedRocker(width: number, height: number, depth: number, radius: number, material: THREE.Material) {
  const geometry = new RoundedBoxGeometry(width, height, depth, 7, radius);
  const positions = geometry.attributes.position;
  const halfWidth = width * .5;
  const halfDepth = depth * .5;

  // The real rocker is not a flat white block. Its centre sits slightly lower,
  // creating the shallow hand-friendly dip visible in the supplied reference.
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const across = Math.min(1, Math.abs(x) / halfWidth);
    const frontBack = Math.min(1, Math.abs(z) / halfDepth);
    const centreWeight = Math.pow(1 - across * across, 1.45) * (.74 + .26 * (1 - frontBack));
    positions.setY(i, positions.getY(i) - .060 * centreWeight);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function segmentRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, on: boolean) {
  ctx.fillStyle = on ? '#18212e' : 'rgba(24,33,46,.065)';
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
  group.name = 'qqurzReferenceTournamentClock';

  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x111315, roughness: .64, metalness: .015, clearcoat: .08, clearcoatRoughness: .72 });
  const shoulderMat = new THREE.MeshPhysicalMaterial({ color: 0x17191b, roughness: .67, metalness: .01, clearcoat: .06, clearcoatRoughness: .76 });
  const lowerMat = new THREE.MeshStandardMaterial({ color: 0x070809, roughness: .78 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x030405, roughness: .56 });
  const whitePlastic = new THREE.MeshPhysicalMaterial({ color: 0xf3f4f5, roughness: .31, metalness: .015, clearcoat: .30, clearcoatRoughness: .36 });
  const iconMat = new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: .58 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: .96 });

  // A low rounded base plus a narrower upper shoulder gives the same wedge/taper
  // seen from the side in the physical clock reference instead of a boxy slab.
  const lower = rounded(3.82, .28, 1.96, .17, lowerMat, 6);
  lower.position.y = .16;
  group.add(lower);

  const body = rounded(3.72, .70, 1.86, .27, bodyMat, 7);
  body.position.set(0, .55, .015);
  group.add(body);

  const shoulder = rounded(3.47, .34, 1.62, .22, shoulderMat, 7);
  shoulder.position.set(0, .94, -.085);
  shoulder.rotation.x = -.035;
  group.add(shoulder);

  // Deep black tray around the rocker, clearly visible from the top/three-quarter view.
  const rockerWell = rounded(3.22, .115, 1.21, .19, bezelMat, 7);
  rockerWell.position.set(0, 1.105, -.15);
  rockerWell.rotation.x = -.035;
  group.add(rockerWell);

  const rocker = groovedRocker(3.06, .205, 1.05, .16, whitePlastic);
  rocker.position.set(0, 1.205, -.15);
  rocker.rotation.x = -.035;
  rocker.userData.clockRocker = true;
  group.add(rocker);

  // A subtle dark centre line makes the shallow physical groove legible at phone size.
  const grooveMaterial = new THREE.MeshBasicMaterial({ color: 0xc8cbd0, transparent: true, opacity: .20, depthWrite: false });
  const groove = new THREE.Mesh(new THREE.PlaneGeometry(.86, .018), grooveMaterial);
  groove.rotation.x = -Math.PI / 2;
  groove.position.set(0, 1.296, -.15);
  group.add(groove);

  const bezel = rounded(3.20, .59, .12, .075, bezelMat, 5);
  bezel.position.set(0, .62, .965);
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
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(2.99, .49), lcdMat);
  lcd.position.set(0, .645, 1.032);
  lcd.rotation.x = -.028;
  group.add(lcd);

  const buttonXs = [-.94, -.315, .315, .94];
  for (const x of buttonXs) {
    const button = rounded(.47, .17, .125, .05, whitePlastic, 4);
    button.position.set(x, .265, .994);
    button.rotation.x = -.028;
    group.add(button);
  }
  addTriangle(group, iconMat, -.94, .275, 1.064, false);
  const resetRing = new THREE.Mesh(new THREE.TorusGeometry(.064, .014, 10, 24), iconMat);
  resetRing.position.set(-.315, .275, 1.064);
  group.add(resetRing);
  addTriangle(group, iconMat, .275, .275, 1.064, false);
  const pause1 = new THREE.Mesh(new THREE.BoxGeometry(.022, .105, .012), iconMat);
  pause1.position.set(.36, .275, 1.066);
  group.add(pause1);
  const pause2 = pause1.clone();
  pause2.position.x = .397;
  group.add(pause2);
  addTriangle(group, iconMat, .94, .275, 1.064, true);

  const seam = new THREE.Mesh(new THREE.BoxGeometry(3.35, .014, 1.72), new THREE.MeshBasicMaterial({ color: 0x020202 }));
  seam.position.set(0, .30, .02);
  group.add(seam);

  for (const [x, z] of [[-1.52, -.72], [1.52, -.72], [-1.52, .72], [1.52, .72]] as const) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.105, .115, .065, 20), footMat);
    foot.position.set(x, .015, z);
    foot.castShadow = true;
    group.add(foot);
  }

  // Larger invisible touch target so the rocker remains easy to slap on iPhone.
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(3.48, .48, 1.34), hitMaterial);
  hit.position.set(0, 1.22, -.15);
  hit.userData.clockRocker = true;
  group.add(hit);

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

    ctx.fillStyle = '#d9dfca';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = activeColor === 'white' ? 'rgba(65,113,75,.14)' : 'rgba(255,255,255,.055)';
    ctx.fillRect(0, 0, 430, 230);
    ctx.fillStyle = activeColor === 'black' ? 'rgba(65,113,75,.14)' : 'rgba(255,255,255,.055)';
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
    ctx.fillStyle = '#18212e';
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
      ctx.fillStyle = 'rgba(24,33,46,.70)';
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${pendingSlap.toUpperCase()} PRESS`, 512, 203);
    }
    texture.needsUpdate = true;
  };

  const slap = (color: Color) => {
    // Physical tournament clocks stay tipped toward the last side that was pressed.
    rocker.rotation.z = color === 'white' ? -.064 : .064;
    rocker.position.y = 1.195;
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
