import type { Color, Key } from '@lichess-org/chessground/types';
import type { Role } from 'chessops/types';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type FenPiece = { square: Key; color: Color; role: Role };
export const THREE_ROLES: Role[] = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
export const THREE_COLORS: Color[] = ['white', 'black'];
// A single role mesh now contains both colors. Twenty covers the theoretical
// maximum after promotions (for example both sides promoting every pawn to rooks).
export const MAX_ROLE_INSTANCES = 20;
export const MAX_LEGAL_DESTS = 32;
/** Top face of the inlaid squares — piece feet sit here. */
export const SQUARE_TOP = 0.185;

const matrixScratch = new THREE.Object3D();
const localPointScratch = new THREE.Vector3();

export function squarePosition(square: Key) {
  return { x: square.charCodeAt(0) - 100.5, z: 4.5 - Number(square[1]) };
}

/** Presentation-only FEN decoding: converts already-authoritative state to meshes. */
export function piecesFromFen(fen: string): FenPiece[] {
  const pieces: FenPiece[] = [];
  (fen.split(' ')[0]?.split('/') ?? []).forEach((row, rowIndex) => {
    let file = 0;
    for (const char of row) {
      if (/\d/.test(char)) { file += Number(char); continue; }
      const lower = char.toLowerCase();
      const role: Role = lower === 'p' ? 'pawn' : lower === 'r' ? 'rook' : lower === 'n' ? 'knight' : lower === 'b' ? 'bishop' : lower === 'q' ? 'queen' : 'king';
      pieces.push({ square: `${String.fromCharCode(97 + file)}${8 - rowIndex}` as Key, color: char === char.toUpperCase() ? 'white' : 'black', role });
      file += 1;
    }
  });
  return pieces;
}

function lathe(points: Array<[number, number]>, segs: number) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(Math.max(0.001, x), y)), segs);
}

function sphereArc(radius: number, cy: number, fromDeg: number, toDeg: number, steps: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = fromDeg + (toDeg - fromDeg) * (i / steps);
    const a = (t * Math.PI) / 180;
    points.push([radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return points;
}

function xform(geo: THREE.BufferGeometry, spec: {
  x?: number; y?: number; z?: number;
  rx?: number; ry?: number; rz?: number;
  sx?: number; sy?: number; sz?: number;
}) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(spec.x ?? 0, spec.y ?? 0, spec.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(spec.rx ?? 0, spec.ry ?? 0, spec.rz ?? 0)),
    new THREE.Vector3(spec.sx ?? 1, spec.sy ?? 1, spec.sz ?? 1),
  );
  geo.applyMatrix4(matrix);
  return geo;
}

function prepare(geo: THREE.BufferGeometry) {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (!geo.getAttribute('uv')) {
    const pos = geo.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i += 1) {
      uv[i * 2] = pos.getX(i) * 1.6 + 0.5;
      uv[i * 2 + 1] = pos.getY(i) * 1.1;
    }
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  if (!geo.index) return geo;
  const next = geo.toNonIndexed();
  geo.dispose();
  return next;
}

function mergeParts(parts: THREE.BufferGeometry[]) {
  const prepared = parts.map(prepare);
  const merged = mergeGeometries(prepared, false);
  prepared.forEach(part => part.dispose());
  if (!merged) {
    throw new Error('Premium 3D failed to merge Staunton geometry.');
  }
  merged.computeBoundingSphere();
  return merged;
}

function stauntonFoot(footR: number, collarY: number, collarR: number, stemR: number, segs: number) {
  return lathe([
    [footR * 0.92, 0],
    [footR, 0.028],
    [footR * 0.98, 0.07],
    [footR * 0.78, 0.095],
    [stemR + 0.04, 0.13],
    [stemR, 0.22],
    [stemR * 0.92, collarY - 0.08],
    [collarR, collarY - 0.03],
    [collarR, collarY + 0.025],
    [collarR * 0.62, collarY + 0.05],
  ], segs);
}

function knightHeadShape() {
  const shape = new THREE.Shape();
  const outline: Array<[number, number]> = [
    [0.00, 0.00],
    [0.10, 0.16],
    [0.14, 0.30],
    [0.28, 0.34],
    [0.50, 0.32],
    [0.66, 0.36],
    [0.76, 0.46],
    [0.78, 0.56],
    [0.70, 0.62],
    [0.52, 0.64],
    [0.38, 0.68],
    [0.34, 0.82],
    [0.30, 0.98],
    [0.20, 1.12],
    [0.10, 1.04],
    [0.14, 0.88],
    [0.08, 0.76],
    [-0.08, 0.64],
    [-0.18, 0.46],
    [-0.16, 0.22],
    [-0.08, 0.04],
  ];
  shape.moveTo(outline[0][0], outline[0][1]);
  shape.splineThru(outline.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
  shape.closePath();
  return shape;
}

function piecePawn(segs: number) {
  const head = sphereArc(0.168, 0.735, -78, 90, Math.max(6, Math.round(segs * 0.7)));
  return lathe([
    [0.325, 0], [0.355, 0.03], [0.348, 0.068], [0.255, 0.10],
    [0.155, 0.16], [0.125, 0.30], [0.122, 0.42],
    [0.188, 0.49], [0.190, 0.545], [0.125, 0.58],
    ...head,
  ], segs);
}

function pieceRook(segs: number) {
  const body = lathe([
    [0.365, 0], [0.392, 0.03], [0.382, 0.072], [0.275, 0.105],
    [0.175, 0.17], [0.155, 0.36], [0.165, 0.58],
    [0.245, 0.66], [0.250, 0.90], [0.205, 0.93],
  ], segs);
  const merlons = [0, 1, 2, 3].map(i => {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    return xform(new THREE.BoxGeometry(0.13, 0.13, 0.20), {
      x: Math.sin(angle) * 0.175,
      y: 0.99,
      z: Math.cos(angle) * 0.175,
    });
  });
  const cap = xform(new THREE.CylinderGeometry(0.16, 0.16, 0.04, segs), { y: 0.91 });
  return mergeParts([body, cap, ...merlons]);
}

function pieceKnight(segs: number) {
  const hi = segs >= 12;
  const depth = hi ? 0.26 : 0.20;
  const base = stauntonFoot(0.355, 0.46, 0.205, 0.145, segs);
  const head = new THREE.ExtrudeGeometry(knightHeadShape(), {
    depth,
    bevelEnabled: true,
    bevelThickness: hi ? 0.028 : 0.016,
    bevelSize: hi ? 0.022 : 0.014,
    bevelOffset: 0,
    bevelSegments: hi ? 2 : 1,
    curveSegments: hi ? 8 : 4,
  });
  head.translate(0, 0, -depth / 2);
  xform(head, {
    x: 0.02,
    y: 0.44,
    ry: Math.PI / 2,
    sx: 0.82,
    sy: 0.62,
    sz: 0.92,
  });
  const ear = xform(new THREE.ConeGeometry(0.038, 0.11, Math.max(6, segs - 2)), {
    x: 0.03, y: 1.10, z: -0.10, rx: -0.62, rz: 0.08,
  });
  return mergeParts([base, head, ear]);
}

function pieceBishop(segs: number) {
  const hi = segs >= 12;
  const body = lathe([
    [0.355, 0], [0.382, 0.03], [0.372, 0.07], [0.265, 0.105],
    [0.155, 0.17], [0.128, 0.48], [0.135, 0.62],
    [0.200, 0.70], [0.198, 0.75], [0.118, 0.80],
    [0.095, 0.86], [0.155, 0.96], [0.132, 1.06],
    [0.055, 1.13], [0.001, 1.13],
  ], segs);
  const knop = xform(new THREE.SphereGeometry(0.055, segs, Math.max(6, segs - 4)), { y: 1.175 });
  const mitre = new THREE.Shape();
  mitre.moveTo(-0.12, 0.82);
  mitre.bezierCurveTo(-0.16, 0.90, -0.15, 1.02, -0.07, 1.12);
  mitre.bezierCurveTo(-0.03, 1.16, 0.03, 1.16, 0.07, 1.12);
  mitre.bezierCurveTo(0.15, 1.02, 0.16, 0.90, 0.12, 0.82);
  mitre.closePath();
  const slit = new THREE.Path();
  slit.moveTo(-0.016, 0.90);
  slit.lineTo(-0.016, 1.10);
  slit.lineTo(0.016, 1.10);
  slit.lineTo(0.016, 0.90);
  slit.closePath();
  mitre.holes.push(slit);
  const mitreGeo = new THREE.ExtrudeGeometry(mitre, {
    depth: hi ? 0.18 : 0.14,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.014,
    bevelSegments: hi ? 2 : 1,
    curveSegments: hi ? 12 : 7,
  });
  xform(mitreGeo, { z: hi ? -0.09 : -0.07 });
  return mergeParts([body, knop, mitreGeo]);
}

function pieceQueen(segs: number) {
  const body = lathe([
    [0.375, 0], [0.405, 0.03], [0.395, 0.074], [0.280, 0.11],
    [0.160, 0.18], [0.132, 0.50], [0.138, 0.70],
    [0.255, 0.82], [0.250, 0.90], [0.175, 0.96],
    [0.195, 1.04], [0.120, 1.08], [0.001, 1.08],
  ], segs);
  const coronet = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    return xform(new THREE.SphereGeometry(0.042, Math.max(6, segs - 4), Math.max(5, segs - 5)), {
      x: Math.sin(angle) * 0.175,
      y: 1.12,
      z: Math.cos(angle) * 0.175,
    });
  });
  const spikes = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    return xform(new THREE.ConeGeometry(0.028, 0.07, Math.max(6, segs - 4)), {
      x: Math.sin(angle) * 0.168,
      y: 1.14,
      z: Math.cos(angle) * 0.168,
      rz: Math.sin(angle) * 0.22,
      rx: Math.cos(angle) * 0.22,
    });
  });
  const crown = xform(new THREE.SphereGeometry(0.07, segs, Math.max(6, segs - 4)), { y: 1.20 });
  return mergeParts([body, crown, ...coronet, ...spikes]);
}

function pieceKing(segs: number) {
  const body = lathe([
    [0.385, 0], [0.418, 0.032], [0.405, 0.076], [0.290, 0.112],
    [0.165, 0.18], [0.135, 0.52], [0.140, 0.74],
    [0.230, 0.88], [0.225, 0.96], [0.155, 1.02],
    [0.145, 1.10], [0.175, 1.16], [0.120, 1.20], [0.001, 1.20],
  ], segs);
  const disc = xform(new THREE.CylinderGeometry(0.13, 0.13, 0.045, segs), { y: 1.22 });
  const upright = xform(new THREE.BoxGeometry(0.055, 0.22, 0.055), { y: 1.34 });
  const bar = xform(new THREE.BoxGeometry(0.16, 0.05, 0.05), { y: 1.38 });
  return mergeParts([body, disc, upright, bar]);
}

export function pieceGeometry(role: Role, radialSegments = 12): THREE.BufferGeometry {
  const segs = Math.max(8, radialSegments);
  const geometry = role === 'pawn' ? piecePawn(segs)
    : role === 'rook' ? pieceRook(segs)
    : role === 'knight' ? pieceKnight(segs)
    : role === 'bishop' ? pieceBishop(segs)
    : role === 'queen' ? pieceQueen(segs)
    : pieceKing(segs);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export function setInstanceMatrix(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, rotationY = 0, sx = 1, sy = 1, sz = 1) {
  matrixScratch.position.set(x, y, z);
  matrixScratch.rotation.set(0, rotationY, 0);
  matrixScratch.scale.set(sx, sy, sz);
  matrixScratch.updateMatrix();
  mesh.setMatrixAt(index, matrixScratch.matrix);
}

export function squareFromWorldPoint(board: THREE.Group, point: THREE.Vector3): Key | null {
  const local = board.worldToLocal(localPointScratch.copy(point));
  if (local.x < -4 || local.x >= 4 || local.z < -4 || local.z >= 4) return null;
  const file = Math.floor(local.x + 4);
  const rank = Math.floor(4 - local.z) + 1;
  return `${String.fromCharCode(97 + file)}${rank}` as Key;
}
