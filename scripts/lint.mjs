import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'shared', 'server/src'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs']);
const ignored = new Set(['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report']);
const failures = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (extensions.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function report(file, line, message) {
  failures.push(`${file}:${line}: ${message}`);
}

for (const file of roots.flatMap(walk)) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((text, index) => {
    const line = index + 1;
    if (/^(<{7}|={7}|>{7})/.test(text)) report(file, line, 'merge-conflict marker is forbidden');
    if (/\bdebugger\s*;?/.test(text)) report(file, line, 'debugger statements are forbidden');
    if (/\beval\s*\(/.test(text)) report(file, line, 'eval() is forbidden');
    if (/\bnew\s+Function\s*\(/.test(text)) report(file, line, 'new Function() is forbidden');
    if (/\/\/\s*@ts-ignore\b/.test(text)) report(file, line, '@ts-ignore is forbidden; use a typed fix or narrowly documented @ts-expect-error');
    if (/[ \t]+$/.test(text)) report(file, line, 'trailing whitespace');
  });
}

if (failures.length) {
  console.error('QQURZ lint failed:\n');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('QQURZ lint OK: no conflict markers, debugger/eval runtime escapes, @ts-ignore bypasses, or trailing whitespace in application source.');
