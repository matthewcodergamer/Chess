import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = path.join(root, 'node_modules', 'stockfish', 'bin');
const destination = path.join(root, 'public', 'stockfish');
const files = [
  'stockfish-18-lite-single.js',
  'stockfish-18-lite-single.wasm',
];

await mkdir(destination, { recursive: true });
for (const file of files) {
  await copyFile(path.join(source, file), path.join(destination, file));
}
console.log('Prepared Stockfish 18 Lite single-threaded browser engine.');
