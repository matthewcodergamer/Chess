import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'public/coins');

const assets = [
  {
    filename: 'quarter-obverse-2021.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/7/70/2021-P_US_Quarter_Obverse.jpg',
    minBytes: 100_000,
  },
  {
    filename: 'quarter-reverse-2021.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/eb/United_States_Quarter_Reverse_2021.jpg',
    minBytes: 50_000,
  },
];

function isJpeg(bytes) {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
}

async function validExisting(path, minBytes) {
  try {
    const bytes = await readFile(path);
    return bytes.length >= minBytes && isJpeg(bytes);
  } catch {
    return false;
  }
}

async function fetchAsset(asset) {
  const path = resolve(outputDir, asset.filename);
  if (await validExisting(path, asset.minBytes)) {
    console.log(`Quarter asset already present: ${asset.filename}`);
    return;
  }

  console.log(`Downloading ${asset.filename}…`);
  const response = await fetch(asset.url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'QQURZ-Chess/1.0 (quarter asset build fetch)',
      accept: 'image/jpeg,image/*;q=0.8,*/*;q=0.2',
    },
  });
  if (!response.ok) throw new Error(`Failed to download ${asset.filename}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < asset.minBytes || !isJpeg(bytes)) {
    throw new Error(`Downloaded ${asset.filename} is not the expected JPEG asset.`);
  }
  await writeFile(path, bytes);
  console.log(`Saved ${asset.filename} (${bytes.length.toLocaleString()} bytes)`);
}

await mkdir(outputDir, { recursive: true });
await Promise.all(assets.map(fetchAsset));
