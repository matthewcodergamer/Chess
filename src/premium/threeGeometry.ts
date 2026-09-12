import type { Color, Key } from '@lichess-org/chessground/types';
import type { Role } from 'chessops/types';
import * as THREE from 'three';

export type FenPiece = { square: Key; color: Color; role: Role };
export const THREE_ROLES: Role[] = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
export const THREE_COLORS: Color[] = ['white', 'black'];
// A single role mesh now contains both colors. Twenty covers the theoretical
// maximum after promotions (for example both sides promoting every pawn to rooks).
export const MAX_ROLE_INSTANCES = 20;
export const MAX_LEGAL_DESTS = 32;

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

export function pieceGeometry(role: Role, radialSegments = 12): THREE.BufferGeometry {
  const points: Array<[number, number]> = role === 'pawn'
    ? [[.34,0],[.38,.08],[.28,.16],[.20,.28],[.15,.54],[.18,.62],[.18,.72],[.10,.80],[0,.96]]
    : role === 'rook'
      ? [[.40,0],[.42,.08],[.32,.16],[.24,.26],[.22,.72],[.31,.82],[.31,.96],[.20,1.03],[0,1.03]]
      : role === 'knight'
        ? [[.38,0],[.40,.08],[.30,.16],[.24,.28],[.20,.58],[.27,.78],[.20,.98],[.08,1.10],[0,1.12]]
        : role === 'bishop'
          ? [[.39,0],[.41,.08],[.30,.16],[.22,.28],[.16,.72],[.22,.84],[.15,.98],[.08,1.10],[0,1.16]]
          : role === 'queen'
            ? [[.41,0],[.43,.08],[.32,.16],[.23,.28],[.17,.76],[.28,.88],[.18,.98],[.24,1.08],[.10,1.16],[0,1.22]]
            : [[.41,0],[.43,.08],[.32,.16],[.23,.28],[.17,.78],[.22,.92],[.15,1.02],[.12,1.18],[.05,1.28],[0,1.30]];
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), Math.max(8, radialSegments));
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
