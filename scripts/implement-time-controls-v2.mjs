import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

let source = fs.readFileSync('scripts/implement-time-controls.mjs', 'utf8');
for (const token of ['orig', 'dest', 'promotion.orig', 'promotion.dest', 'piece']) {
  source = source.replaceAll('${' + token + '}', '\\${' + token + '}');
}
const temp = '/tmp/qqurz-implement-time-controls.mjs';
fs.writeFileSync(temp, source);
await import(pathToFileURL(temp).href + `?v=${Date.now()}`);
