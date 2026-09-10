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

const CLOCK_MM = { width: 132, depth: 114, height: 36 } as const;
const CLOCK_W = 3.96;
const CLOCK_D = CLOCK_W * (CLOCK_MM.depth / CLOCK_MM.width);
const FRONT_Z = CLOCK_D * 0.5;
const ROCKER_BASE_X = -0.075;

function fmt(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function rounded(width: number, height: number, depth: number, radius: number, material: THREE.Material, segments = 4) {
  return new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, segments, radius), material);
}

function createRocker(material: THREE.Material) {
  const width = 3.34;
  const height = 0.22;
  const depth = 2.28;
  const geometry = new RoundedBoxGeometry(width, height, depth, 5, 0.16);
  const positions = geometry.attributes.position;
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const nx = Math.min(1, Math.abs(x) / halfWidth);
    const nz = Math.min(1, Math.abs(z) / halfDepth);
    const saddle = Math.pow(1 - nx * nx, 1.25) * (0.72 + 0.28 * (1 - nz));
    positions.setY(i, positions.getY(i) - 0.06 * saddle);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function fitTime(ctx: CanvasRenderingContext2D, value: string, centerX: number, baselineY: number, maxWidth: number) {
  let size = 170;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 ${size}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  while (ctx.measureText(value).width > maxWidth && size > 118) {
    size -= 4;
    ctx.font = `900 ${size}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  }
  ctx.fillText(value, centerX, baselineY);
}

export function createChessClock3D(): ChessClock3DModel {
  const group = new THREE.Group();
  group.name = 'qqurzOptimizedTournamentClock3D';
  group.userData.dimensionsMm = { ...CLOCK_MM };

  // The clock is viewed from the front/top in QQURZ, so rear/bottom accessories,
  // feet, battery doors and speaker perforations are intentionally omitted.
  // This keeps the silhouette physical while cutting a large number of meshes.
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.72, metalness: 0.02 });
  const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.76, metalness: 0.01 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.72, metalness: 0.02 });
  const whitePlastic = new THREE.MeshStandardMaterial({ color: 0xf4f5f6, roughness: 0.42, metalness: 0.01 });
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xe8e9ea, roughness: 0.48, metalness: 0.01 });
  const ledOff = 0x173126;
  const ledOn = 0x61ef9b;
  const leftLedMat = new THREE.MeshBasicMaterial({ color: ledOff });
  const rightLedMat = new THREE.MeshBasicMaterial({ color: ledOff });

  const body = rounded(CLOCK_W, 0.72, CLOCK_D - 0.18, 0.24, bodyMat, 4);
  body.position.set(0, 0.40, 0.06);
  group.add(body);

  const shoulder = rounded(CLOCK_W - 0.32, 0.34, CLOCK_D - 0.58, 0.20, shoulderMat, 4);
  shoulder.position.set(0, 0.79, -0.22);
  shoulder.rotation.x = -0.07;
  group.add(shoulder);

  const rockerWell = rounded(3.52, 0.12, 2.48, 0.18, bezelMat, 4);
  rockerWell.position.set(0, 0.93, -0.24);
  rockerWell.rotation.x = ROCKER_BASE_X;
  group.add(rockerWell);

  const rocker = createRocker(whitePlastic);
  rocker.position.set(0, 1.06, -0.24);
  rocker.rotation.x = ROCKER_BASE_X;
  rocker.userData.clockRocker = true;
  group.add(rocker);

  const bezel = rounded(3.54, 0.78, 0.12, 0.075, bezelMat, 4);
  bezel.position.set(0, 0.48, FRONT_Z - 0.09);
  bezel.rotation.x = -0.025;
  group.add(bezel);

  // Bigger LCD: the numbers now use almost the entire display height.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 300;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is required for the chess clock LCD.');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const lcdMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(3.30, 0.66), lcdMat);
  lcd.position.set(0, 0.505, FRONT_Z + 0.005);
  lcd.rotation.x = -0.025;
  group.add(lcd);

  // Keep the recognizable four front controls, but use simple geometry.
  const keyGeometry = new RoundedBoxGeometry(0.45, 0.14, 0.12, 3, 0.045);
  for (const x of [-0.98, -0.33, 0.33, 0.98]) {
    const key = new THREE.Mesh(keyGeometry, keyMat);
    key.position.set(x, 0.13, FRONT_Z - 0.01);
    group.add(key);
  }

  const ledGeometry = new THREE.CircleGeometry(0.075, 12);
  const leftLed = new THREE.Mesh(ledGeometry, leftLedMat);
  leftLed.position.set(-1.58, 0.17, FRONT_Z + 0.04);
  group.add(leftLed);
  const rightLed = new THREE.Mesh(ledGeometry.clone(), rightLedMat);
  rightLed.position.set(1.58, 0.17, FRONT_Z + 0.04);
  group.add(rightLed);

  let lastSignature = '';
  let rockerTarget = 0;
  let rockerFrom = 0;
  let rockerTransitionStarted = performance.now();
  let slapColor: Color | null = null;
  let slapStarted = 0;

  const targetForActive = (activeColor?: Color | null) => {
    // If White's clock is running, Black has just pressed the right-hand side,
    // and vice versa. This makes the physical seesaw visibly change direction.
    if (activeColor === 'white') return -0.095;
    if (activeColor === 'black') return 0.095;
    return 0;
  };

  const draw = (whiteSeconds: number, blackSeconds: number, activeColor?: Color | null, pendingSlap?: Color | null) => {
    const white = fmt(whiteSeconds);
    const black = fmt(blackSeconds);
    const signature = `${white}|${black}|${activeColor ?? ''}|${pendingSlap ?? ''}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    ctx.fillStyle = '#cbd5aa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#adb98d';
    ctx.fillRect(510, 20, 4, 260);

    ctx.font = '800 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = activeColor === 'white' ? '#172019' : '#53604d';
    ctx.fillText(pendingSlap === 'white' ? 'WHITE · PRESS' : 'WHITE', 256, 36);
    ctx.fillStyle = activeColor === 'black' ? '#172019' : '#53604d';
    ctx.fillText(pendingSlap === 'black' ? 'BLACK · PRESS' : 'BLACK', 768, 36);

    ctx.fillStyle = '#101713';
    fitTime(ctx, white, 256, 235, 455);
    fitTime(ctx, black, 768, 235, 455);
    texture.needsUpdate = true;

    leftLedMat.color.set(activeColor === 'white' || pendingSlap === 'white' ? ledOn : ledOff);
    rightLedMat.color.set(activeColor === 'black' || pendingSlap === 'black' ? ledOn : ledOff);
  };

  const update = (whiteSeconds: number, blackSeconds: number, activeColor?: Color | null, pendingSlap?: Color | null) => {
    draw(whiteSeconds, blackSeconds, activeColor, pendingSlap);
    const now = performance.now();
    const nextTarget = targetForActive(activeColor);
    if (Math.abs(nextTarget - rockerTarget) > 0.0001) {
      rockerFrom = rocker.rotation.z;
      rockerTarget = nextTarget;
      rockerTransitionStarted = now;
    }

    if (slapColor && now - slapStarted < 190) {
      const elapsed = now - slapStarted;
      const pressed = slapColor === 'white' ? 0.145 : -0.145;
      if (elapsed < 70) {
        const t = elapsed / 70;
        rocker.rotation.z = THREE.MathUtils.lerp(rockerFrom, pressed, 1 - Math.pow(1 - t, 3));
      } else {
        const t = Math.min(1, (elapsed - 70) / 120);
        rocker.rotation.z = THREE.MathUtils.lerp(pressed, rockerTarget, 1 - Math.pow(1 - t, 3));
      }
      if (elapsed >= 188) slapColor = null;
      return;
    }

    const transition = Math.min(1, (now - rockerTransitionStarted) / 170);
    rocker.rotation.z = THREE.MathUtils.lerp(rockerFrom, rockerTarget, 1 - Math.pow(1 - transition, 3));
  };

  const slap = (color: Color) => {
    slapColor = color;
    slapStarted = performance.now();
    rockerFrom = rocker.rotation.z;
  };

  update(600, 600, null, null);

  return {
    group,
    rocker,
    hitTargets: [rocker],
    update,
    slap,
    setVisible: visible => { group.visible = visible; },
    dispose: () => {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(material => materials.add(material));
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      texture.dispose();
    },
  };
}
