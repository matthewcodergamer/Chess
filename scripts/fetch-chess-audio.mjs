import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'public/sounds/chess');

// All sources below are CC0 recordings / organic impacts from OpenGameArt.
// They are fetched at build time so production never depends on a third-party
// audio host during a game. See public/sounds/chess/SOURCES.md.
const assets = [
  { filename: 'move.mp3', url: 'https://opengameart.org/sites/default/files/click_sound_1.mp3', minBytes: 7_000, kind: 'mp3' },
  { filename: 'check.mp3', url: 'https://opengameart.org/sites/default/files/click_sound_2.mp3', minBytes: 7_000, kind: 'mp3' },
  { filename: 'game-start.mp3', url: 'https://opengameart.org/sites/default/files/click_sound_5.mp3', minBytes: 5_000, kind: 'mp3' },
  { filename: 'clock.mp3', url: 'https://opengameart.org/sites/default/files/click_sound.mp3', minBytes: 7_000, kind: 'mp3' },
  { filename: 'coin.mp3', url: 'https://opengameart.org/sites/default/files/coin_drop_0.mp3', minBytes: 30_000, kind: 'mp3' },
  { filename: 'capture.wav', url: 'https://opengameart.org/sites/default/files/lightclunk1.wav', minBytes: 20_000, kind: 'wav' },
  { filename: 'game-end.wav', url: 'https://opengameart.org/sites/default/files/lightclunk2.wav', minBytes: 18_000, kind: 'wav' },
];

function isMp3(bytes) {
  if (bytes.length < 4) return false;
  return (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function isWav(bytes) {
  if (bytes.length < 12) return false;
  return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE';
}

function validBytes(bytes, asset) {
  return bytes.length >= asset.minBytes && (asset.kind === 'mp3' ? isMp3(bytes) : isWav(bytes));
}

async function validExisting(path, asset) {
  try { return validBytes(await readFile(path), asset); }
  catch { return false; }
}

async function fetchAsset(asset) {
  const path = resolve(outputDir, asset.filename);
  if (await validExisting(path, asset)) {
    console.log(`Chess audio already present: ${asset.filename}`);
    return;
  }

  console.log(`Downloading recorded chess audio ${asset.filename}…`);
  const response = await fetch(asset.url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'QQURZ-Chess/1.0 (recorded chess audio build fetch)',
      accept: 'audio/mpeg,audio/wav,audio/x-wav,application/octet-stream,*/*;q=0.2',
    },
  });
  if (!response.ok) throw new Error(`Failed to download ${asset.filename}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!validBytes(bytes, asset)) throw new Error(`Downloaded ${asset.filename} is not the expected recorded audio asset.`);
  await writeFile(path, bytes);
  console.log(`Saved ${asset.filename} (${bytes.length.toLocaleString()} bytes)`);
}

await mkdir(outputDir, { recursive: true });
await Promise.all(assets.map(fetchAsset));
