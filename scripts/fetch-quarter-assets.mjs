import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'public/coins');
const RETRIES = 4;
const REQUEST_TIMEOUT_MS = 20_000;

const assets = [
  {
    filename: 'quarter-obverse-2021.jpg',
    urls: [
      'https://upload.wikimedia.org/wikipedia/commons/7/70/2021-P_US_Quarter_Obverse.jpg',
      'https://commons.wikimedia.org/wiki/Special:Redirect/file/2021-P_US_Quarter_Obverse.jpg',
    ],
    minBytes: 100_000,
  },
  {
    filename: 'quarter-reverse-2021.jpg',
    urls: [
      'https://upload.wikimedia.org/wikipedia/commons/e/eb/United_States_Quarter_Reverse_2021.jpg',
      'https://commons.wikimedia.org/wiki/Special:Redirect/file/United_States_Quarter_Reverse_2021.jpg',
    ],
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

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function download(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'QQURZ-Chess/1.0 (quarter asset build fetch)',
        accept: 'image/jpeg,image/*;q=0.8,*/*;q=0.2',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAsset(asset) {
  const path = resolve(outputDir, asset.filename);
  if (await validExisting(path, asset.minBytes)) {
    console.log(`Quarter asset already present: ${asset.filename}`);
    return;
  }

  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const url = asset.urls[(attempt - 1) % asset.urls.length];
    try {
      console.log(`Downloading ${asset.filename} (attempt ${attempt}/${RETRIES})…`);
      const bytes = await download(url);
      if (bytes.length < asset.minBytes || !isJpeg(bytes)) {
        throw new Error('response was not the expected JPEG asset');
      }
      await writeFile(path, bytes);
      console.log(`Saved ${asset.filename} (${bytes.length.toLocaleString()} bytes)`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Quarter asset attempt ${attempt} failed for ${asset.filename}: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt < RETRIES) await delay(750 * attempt);
    }
  }

  throw new Error(`Failed to download ${asset.filename} after ${RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

await mkdir(outputDir, { recursive: true });
// Keep downloads sequential. This is slower by milliseconds on a healthy CDN,
// but much less likely to trip shared-runner connection limits than parallel requests.
for (const asset of assets) await fetchAsset(asset);
