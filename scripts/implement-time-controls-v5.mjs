import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

let source = fs.readFileSync('scripts/implement-time-controls.mjs', 'utf8');
source = source.replaceAll('\\`${orig}', '\\`\\${orig}');
source = source.replaceAll('\\`${promotion.orig}', '\\`\\${promotion.orig}');
source = source.replace("const path = 'src/experience.css';", "const path = 'src/styles/forms.css';");
const temp = '/tmp/qqurz-implement-time-controls-v5.mjs';
fs.writeFileSync(temp, source);
await import(pathToFileURL(temp).href + `?v=${Date.now()}`);

// Replace migration prototype CSS with the repository's strict token system.
const formsPath = 'src/styles/forms.css';
let forms = fs.readFileSync(formsPath, 'utf8');
const pickerIndex = forms.indexOf('\n\n.time-control-picker{');
if (pickerIndex >= 0) forms = forms.slice(0, pickerIndex).trimEnd() + '\n';
forms += `
.time-control-picker{display:grid;gap:var(--q-space-12);padding:var(--q-space-16);border:1px solid var(--q-line);border-radius:var(--q-radius-md);background:var(--q-surface-1)}
.time-control-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--q-space-12);font-size:var(--q-type-label-sm)}
.time-control-heading span{color:var(--q-muted)}
.time-control-heading b{font-size:var(--q-type-label)}
.time-control-pills{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--q-space-8)}
.time-control-pills button{min-height:var(--q-control-sm);border-radius:var(--q-radius-sm);border:1px solid var(--q-line-strong);background:var(--q-surface-2);color:var(--q-text);font-weight:800}
.time-control-pills button.selected{background:var(--q-action);color:var(--q-text-inverse);border-color:var(--q-action);box-shadow:var(--q-elevation-action)}
.time-control-custom{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:var(--q-space-12)}
.time-control-custom label{display:grid;gap:var(--q-space-8)}
.time-control-custom label span{font-size:var(--q-type-caption);color:var(--q-muted);font-weight:700}
.time-control-custom input{width:100%;min-height:var(--q-control-sm);border-radius:var(--q-radius-sm);border:1px solid var(--q-line-strong);background:var(--q-surface-2);color:var(--q-text);padding:0 var(--q-space-12)}
.time-control-plus{padding-bottom:var(--q-space-12);font-weight:900}
`;
fs.writeFileSync(formsPath, forms);

const responsivePath = 'src/styles/responsive.css';
let responsive = fs.readFileSync(responsivePath, 'utf8');
if (!responsive.includes('.time-control-pills{grid-template-columns:repeat(2,minmax(0,1fr))}')) {
  responsive += `\n@media(max-width:560px){.time-control-pills{grid-template-columns:repeat(2,minmax(0,1fr))}}\n`;
}
fs.writeFileSync(responsivePath, responsive);

// Scope timestamp cleanups to the handlers that own each timestamp.
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
