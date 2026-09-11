import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const errors = [];

const physicalPath = 'src/ui/PhysicalChessClock.tsx';
const viewPath = 'src/ui/ChessClock3DView.tsx';
const modelPath = 'src/premium/chessClock3D.ts';
const localPath = 'src/LocalGame.tsx';
const onlinePath = 'src/multiplayer/OnlineArena.tsx';
const premiumPath = 'src/premium/PremiumBoard3D.tsx';

for (const file of [physicalPath, viewPath, modelPath, localPath, onlinePath, premiumPath]) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`Missing clock-system file: ${file}`);
}

if (!errors.length) {
  const physical = read(physicalPath);
  const view = read(viewPath);
  const model = read(modelPath);
  const local = read(localPath);
  const online = read(onlinePath);
  const premium = read(premiumPath);

  for (const [label, source] of [['LocalGame', local], ['OnlineArena', online], ['PremiumBoard3D', premium]]) {
    if (!source.includes('PhysicalChessClock')) errors.push(`${label} must render PhysicalChessClock.`);
    if (source.includes('ChessClock3DView')) errors.push(`${label} must not render ChessClock3DView directly.`);
    if (source.includes('ChessClock2D')) errors.push(`${label} must not use the legacy ChessClock2D wrapper.`);
    if (source.includes('createChessClock3D')) errors.push(`${label} must not instantiate the physical 3D clock model directly.`);
    if (source.includes("playChessSound('slap')")) errors.push(`${label} must not play clock slap sound directly; authoritative transfer owns sound.`);
    if (/\.clock\.slap\s*\(/.test(source)) errors.push(`${label} must not drive rocker animation directly.`);
  }

  if (!view.includes('createChessClock3D')) errors.push('ChessClock3DView must be the single renderer that instantiates the clock model.');
  if (!view.includes('slapColor') || !view.includes('slapNonce')) errors.push('ChessClock3DView must receive explicit authoritative slap events.');
  if (!physical.includes("playChessSound('slap')")) errors.push('PhysicalChessClock must own the physical slap sound.');
  if (!physical.includes('previous && !pendingSlap && activeColor && activeColor !== previous')) errors.push('PhysicalChessClock must gate slap feedback on an acknowledged clock transfer.');

  const localDualSlap = local.includes('session.pendingClockPress === aiColor ? 220 : 120') || local.includes('pendingSlap === aiColor ? 220 : 120');
  const premiumDualSlap = premium.includes('session.pendingClockPress === aiColor ? 220 : 120') || premium.includes('pendingSlap === aiColor ? 220 : 120');
  if (!localDualSlap) errors.push('AI 2D play must auto-ack both human and Stockfish physical clock presses.');
  if (!premiumDualSlap) errors.push('Premium AI play must auto-ack both human and Stockfish physical clock presses.');

  const onlineUsesAuthoritativeSession =
    online.includes('authoritativeRoomSession(snapshot)')
    && online.includes('clockOwner(gameSession)')
    && online.includes('gameSession.clocks.whiteMs')
    && online.includes('gameSession.clocks.blackMs')
    && online.includes('activeColor={activeColor}')
    && /pendingSlap=\{gameSession\?\.pendingClockPress(?:\s*\?\?\s*null)?\}/.test(online);
  if (!onlineUsesAuthoritativeSession) errors.push('Online clock must consume active side, pending press and remaining time from the authoritative GameSessionModel.');

  const forbiddenLegacyOnlineClockReads = [
    'snapshot.activeClock',
    'snapshot.awaitingClockPress',
    'snapshot.whiteClockMs',
    'snapshot.blackClockMs',
  ].filter(token => online.includes(token));
  if (forbiddenLegacyOnlineClockReads.length) {
    errors.push(`Online clock must not derive state from legacy room aliases: ${forbiddenLegacyOnlineClockReads.join(', ')}.`);
  }

  if (!model.includes('let size = 210')) errors.push('Physical clock LCD must keep the enlarged timer digit target.');
  if (!model.includes('ROCKER_PRESS')) errors.push('Physical clock model must retain a real rocker press angle.');
  if (!model.includes('optimizedForMobile = true')) errors.push('Physical clock model must retain the mobile-geometry optimization marker.');
  if (!model.includes("pendingSlap === 'white' ? ledOn") && !model.includes("pendingSlap === 'white' ?")) {
    if (!model.includes("activeColor === 'white' || pendingSlap === 'white'")) errors.push('White LED must be derived from authoritative active/pending state.');
  }
  if (!model.includes("activeColor === 'black' || pendingSlap === 'black'")) errors.push('Black LED must be derived from authoritative active/pending state.');

  const srcRoot = path.join(root, 'src');
  const sourceFiles = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) sourceFiles.push(full);
    }
  };
  walk(srcRoot);

  const directSoundOwners = sourceFiles
    .filter(file => fs.readFileSync(file, 'utf8').includes("playChessSound('slap')"))
    .map(file => path.relative(root, file).replaceAll('\\', '/'));
  if (directSoundOwners.length !== 1 || directSoundOwners[0] !== physicalPath) {
    errors.push(`Clock slap sound must have one owner (${physicalPath}); found: ${directSoundOwners.join(', ') || 'none'}.`);
  }

  const modelImporters = sourceFiles
    .filter(file => file !== path.join(root, modelPath) && fs.readFileSync(file, 'utf8').includes('createChessClock3D'))
    .map(file => path.relative(root, file).replaceAll('\\', '/'));
  if (modelImporters.length !== 1 || modelImporters[0] !== viewPath) {
    errors.push(`Clock 3D model must have one renderer (${viewPath}); found: ${modelImporters.join(', ') || 'none'}.`);
  }
}

if (errors.length) {
  console.error('\nQQURZ physical-clock check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('QQURZ physical clock OK: one renderer/component, authoritative GameSession timing, AI dual slap, mobile-optimized geometry.');