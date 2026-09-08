import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Color } from '@lichess-org/chessground/types';

export type ChessClock3DModel = {
  group: THREE.Group;
  rocker: THREE.Mesh;
  hitTargets: THREE.Object3D[];
  update: (whiteSeconds: number, blackSeconds: number, activeColor?: Color | null, pendingSlap?: Color | null) => void;
  slap: (color: Color) => void;
  dispose: () => void;
};

function fmt(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function rounded(width: number, height: number, depth: number, radius: number, material: THREE.Material) {
  const geo = new RoundedBoxGeometry(width, height, depth, 5, radius);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function drawTriangle(material: THREE.Material, x: number, y: number, z: number, flip = false) {
  const shape = new THREE.Shape();
  shape.moveTo(0, flip ? -.07 : .07);
  shape.lineTo(-.075, flip ? .06 : -.06);
  shape.lineTo(.075, flip ? .06 : -.06);
  shape.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  m.position.set(x, y, z);
  return m;
}

const SEGMENTS: Record<string, number[]> = {
  '0': [1,1,1,1,1,1,0], '1': [0,1,1,0,0,0,0], '2': [1,1,0,1,1,0,1], '3': [1,1,1,1,0,0,1],
  '4': [0,1,1,0,0,1,1], '5': [1,0,1,1,0,1,1], '6': [1,0,1,1,1,1,1], '7': [1,1,1,0,0,0,0],
  '8': [1,1,1,1,1,1,1], '9': [1,1,1,1,0,1,1],
};

function segmentRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, on: boolean) {
  ctx.fillStyle = on ? '#1a2230' : 'rgba(26,34,48,.075)';
  ctx.beginPath();
  const cut = Math.min(w, h) * .28;
  ctx.moveTo(x + cut, y); ctx.lineTo(x + w - cut, y); ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - cut, y + h); ctx.lineTo(x + cut, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath(); ctx.fill();
}

function drawDigit(ctx: CanvasRenderingContext2D, digit: string, x: number, y: number, w: number, h: number) {
  const on = SEGMENTS[digit] ?? [0,0,0,0,0,0,0];
  const t = Math.max(4, w * .13); const half = h / 2;
  segmentRect(ctx, x + t, y, w - 2*t, t, Boolean(on[0]));
  segmentRect(ctx, x + w - t, y + t, t, half - 1.5*t, Boolean(on[1]));
  segmentRect(ctx, x + w - t, y + half + .5*t, t, half - 1.5*t, Boolean(on[2]));
  segmentRect(ctx, x + t, y + h - t, w - 2*t, t, Boolean(on[3]));
  segmentRect(ctx, x, y + half + .5*t, t, half - 1.5*t, Boolean(on[4]));
  segmentRect(ctx, x, y + t, t, half - 1.5*t, Boolean(on[5]));
  segmentRect(ctx, x + t, y + half - t/2, w - 2*t, t, Boolean(on[6]));
}

function drawTime(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, height: number) {
  const chars = value.split('');
  const gap = 8;
  const colonW = 18;
  const digitCount = chars.filter(c => c !== ':').length;
  const digitW = (width - colonW - gap * (chars.length - 1)) / digitCount;
  let cx = x;
  for (const char of chars) {
    if (char === ':') {
      ctx.fillStyle = '#1a2230';
      ctx.beginPath(); ctx.arc(cx + colonW/2, y + height*.36, 5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + colonW/2, y + height*.66, 5, 0, Math.PI*2); ctx.fill();
      cx += colonW + gap;
    } else {
      drawDigit(ctx, char, cx, y, digitW, height);
      cx += digitW + gap;
    }
  }
}

export function createChessClock3D(): ChessClock3DModel {
  const group = new THREE.Group();
  group.name = 'qqurzTournamentClock';

  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x111315, roughness: .58, metalness: .02, clearcoat: .12, clearcoatRoughness: .64 });
  const lowerMat = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: .72 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: .5 });
  const whitePlastic = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f6, roughness: .34, metalness: .02, clearcoat: .26, clearcoatRoughness: .42 });
  const iconMat = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: .55 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: .9 });

  const lower = rounded(3.55, .30, 1.78, .15, lowerMat); lower.position.y = .18; group.add(lower);
  const body = rounded(3.58, .82, 1.72, .25, bodyMat); body.position.set(0, .58, 0); group.add(body);

  const topInset = rounded(3.10, .08, 1.14, .17, bezelMat); topInset.position.set(0, 1.015, -.12); group.add(topInset);
  const rocker = rounded(3.00, .18, 1.03, .15, whitePlastic); rocker.position.set(0, 1.12, -.12); rocker.userData.clockRocker = true; group.add(rocker);

  const bezel = rounded(3.15, .60, .11, .08, bezelMat); bezel.position.set(0, .63, .866); group.add(bezel);

  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 220;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is required for the chess clock LCD.');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  const lcdMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(2.94, .49), lcdMat); lcd.position.set(0, .66, .925); group.add(lcd);

  const brandCanvas = document.createElement('canvas'); brandCanvas.width = 256; brandCanvas.height = 64; const bctx = brandCanvas.getContext('2d');
  if (bctx) { bctx.clearRect(0,0,256,64); bctx.fillStyle = '#f4f4f4'; bctx.font = '700 30px system-ui'; bctx.textAlign = 'center'; bctx.fillText('QQURZ',128,40); }
  const brandTexture = new THREE.CanvasTexture(brandCanvas); brandTexture.colorSpace = THREE.SRGBColorSpace;
  const brand = new THREE.Mesh(new THREE.PlaneGeometry(.66,.16), new THREE.MeshBasicMaterial({map:brandTexture,transparent:true,toneMapped:false})); brand.position.set(0,.985,.865); group.add(brand);

  const buttonXs = [-.92,-.31,.31,.92];
  buttonXs.forEach((x) => { const button = rounded(.47,.18,.12,.055,whitePlastic); button.position.set(x,.28,.928); group.add(button); });
  group.add(drawTriangle(iconMat,-.92,.29,.997,false));
  const resetRing = new THREE.Mesh(new THREE.TorusGeometry(.065,.015,10,24), iconMat); resetRing.position.set(-.31,.29,.997); group.add(resetRing);
  group.add(drawTriangle(iconMat,.27,.29,.997,false));
  const pauseBar1 = new THREE.Mesh(new THREE.BoxGeometry(.022,.11,.012),iconMat); pauseBar1.position.set(.36,.29,.999); group.add(pauseBar1);
  const pauseBar2 = pauseBar1.clone(); pauseBar2.position.x=.395; group.add(pauseBar2);
  group.add(drawTriangle(iconMat,.92,.29,.997,true));

  const seam = new THREE.Mesh(new THREE.BoxGeometry(3.22,.012,1.58), new THREE.MeshBasicMaterial({color:0x030303})); seam.position.y=.31; group.add(seam);
  [[-1.45,-.66],[1.45,-.66],[-1.45,.66],[1.45,.66]].forEach(([x,z]) => {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.10,.11,.06,20),footMat); foot.position.set(x,.02,z); foot.castShadow=true; group.add(foot);
  });

  let raf = 0;
  let lastWhite = -1, lastBlack = -1, lastActive: Color | null | undefined, lastPending: Color | null | undefined;
  const update = (whiteSeconds: number, blackSeconds: number, activeColor?: Color | null, pendingSlap?: Color | null) => {
    const white = Math.ceil(whiteSeconds), black = Math.ceil(blackSeconds);
    if (white===lastWhite && black===lastBlack && activeColor===lastActive && pendingSlap===lastPending) return;
    lastWhite=white; lastBlack=black; lastActive=activeColor; lastPending=pendingSlap;
    ctx.fillStyle = '#d8dec9'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = activeColor==='white' ? 'rgba(71,120,79,.13)' : 'rgba(255,255,255,.07)'; ctx.fillRect(0,0,430,220);
    ctx.fillStyle = activeColor==='black' ? 'rgba(71,120,79,.13)' : 'rgba(255,255,255,.07)'; ctx.fillRect(594,0,430,220);
    ctx.strokeStyle='rgba(30,40,34,.28)'; ctx.lineWidth=3; ctx.strokeRect(4,4,1016,212); ctx.beginPath();ctx.moveTo(500,8);ctx.lineTo(500,212);ctx.moveTo(524,8);ctx.lineTo(524,212);ctx.stroke();
    drawTime(ctx, fmt(whiteSeconds), 30, 32, 390, 142); drawTime(ctx, fmt(blackSeconds), 604, 32, 390, 142);
    ctx.fillStyle='#1a2230';ctx.font='700 24px ui-monospace, monospace';ctx.textAlign='center';ctx.fillText('03',512,48);ctx.font='600 19px system-ui';ctx.fillText('bonus',512,118);ctx.beginPath();ctx.arc(555,112,6,0,Math.PI*2);ctx.fill();
    ctx.font='700 19px ui-monospace, monospace';ctx.textAlign='left';ctx.fillText('000',358,28);ctx.textAlign='right';ctx.fillText('000',666,28);
    if (pendingSlap) { ctx.fillStyle='rgba(26,34,48,.72)';ctx.font='800 15px system-ui';ctx.textAlign='center';ctx.fillText(`${pendingSlap.toUpperCase()} PRESS`,512,190); }
    texture.needsUpdate = true;
  };

  const slap = (color: Color) => {
    if (raf) cancelAnimationFrame(raf);
    const start = performance.now(); const duration=250; const direction = color==='white' ? -1 : 1;
    const tick = (now:number) => {
      const t=Math.min(1,(now-start)/duration); const press=t<.36?t/.36:(1-t)/.64; const bounce=Math.sin(t*Math.PI*2.4)*(1-t)*.018;
      rocker.rotation.z = direction * (.105 * Math.max(0,press) + bounce);
      if (t<1) raf=requestAnimationFrame(tick); else { rocker.rotation.z=0; raf=0; }
    };
    raf=requestAnimationFrame(tick);
  };

  const dispose = () => {
    if (raf) cancelAnimationFrame(raf);
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of mats) { const map=(mat as THREE.MeshBasicMaterial).map; if (map) map.dispose(); mat.dispose(); }
    });
  };

  update(600,600,'white',null);
  return { group, rocker, hitTargets: [rocker], update, slap, dispose };
}
