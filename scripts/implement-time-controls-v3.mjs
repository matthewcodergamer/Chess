import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

let source = fs.readFileSync('scripts/implement-time-controls.mjs', 'utf8');
// Only the first interpolation inside each nested template literal is actually
// unescaped in the original migration source. Escape those without touching
// the already-escaped destination/promotion suffix markers.
source = source.replaceAll('\\`${orig}', '\\`\\${orig}');
source = source.replaceAll('\\`${promotion.orig}', '\\`\\${promotion.orig}');
const temp = '/tmp/qqurz-implement-time-controls-v3.mjs';
fs.writeFileSync(temp, source);
await import(pathToFileURL(temp).href + `?v=${Date.now()}`);

// The original migration intentionally performs a broad timeout replacement.
// Scope the resulting timestamp references to their actual handlers before the
// build checks run: clock slap uses `now`; move receipt uses `serverReceivedAt`.
const serverPath = 'server/src/index.ts';
let server = fs.readFileSync(serverPath, 'utf8');
const slapStart = server.indexOf('  private async handleClockSlap(');
const drawStart = server.indexOf('  private async handleDrawOffer(', slapStart);
if (slapStart >= 0 && drawStart > slapStart) {
  const slap = server.slice(slapStart, drawStart).replaceAll('this.room.lastActivityAt = serverReceivedAt;', 'this.room.lastActivityAt = now;');
  server = server.slice(0, slapStart) + slap + server.slice(drawStart);
}
const moveStart = server.indexOf('  private async handleMove(');
const persistStart = server.indexOf('  private async persist(', moveStart);
if (moveStart >= 0 && persistStart > moveStart) {
  const move = server.slice(moveStart, persistStart).replace('this.room.lastActivityAt = now;', 'this.room.lastActivityAt = serverReceivedAt;');
  server = server.slice(0, moveStart) + move + server.slice(persistStart);
}
fs.writeFileSync(serverPath, server);
