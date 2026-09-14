import { readFile } from 'node:fs/promises';

const manifest = await readFile('public/sounds/chess/SOURCES.md', 'utf8');
const required = [
  'move.mp3',
  'capture.wav',
  'check.mp3',
  'game-start.mp3',
  'game-end.wav',
  'clock.mp3',
];

for (const asset of required) {
  if (!manifest.includes(asset)) throw new Error(`Audio source manifest missing ${asset}`);
}
if (!manifest.includes('CC0')) throw new Error('Audio source manifest must state the CC0 license.');
console.log('QQURZ recorded audio source manifest OK.');
