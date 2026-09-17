import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const errors = [];

const physicalPath = 'src/ui/PhysicalChessClock.tsx';
const localPath = 'src/LocalGame.tsx';
const localChromePath = 'src/game/LocalMatchChrome.tsx';
const localControllerPath = 'src/game/useLocalGameController.ts';
const onlinePath = 'src/multiplayer/OnlineArena.tsx';
const premiumPath = 'src/premium/PremiumBoard3D.tsx';

for (const file of [physicalPath, localPath, localChromePath, localControllerPath, onlinePath, premiumPath]) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`Missing clock-system file: ${file}`);
}

if (!errors.length) {
  const physical = read(physicalPath);
  const local = read(localPath);
  const localChrome = read(localChromePath);
  const localController = read(localControllerPath);
  const online = read(onlinePath);
  const premium = read(premiumPath);

  // The physical/3D clock and slap interaction are retired. Keep the shim file
  // so old imports cannot accidentally resurrect the interface, but require it
  // to remain inert.
  if (!/return\s+null\s*;/.test(physical)) errors.push('PhysicalChessClock must remain an inert compatibility shim.');

  for (const [label, source] of [['OnlineArena', online], ['PremiumBoard3D', premium]]) {
    if (source.includes('ChessClock3DView')) errors.push(`${label} must not render ChessClock3DView.`);
    if (source.includes('createChessClock3D')) errors.push(`${label} must not instantiate the 3D clock model.`);
    if (/onSlap\s*=/.test(source)) errors.push(`${label} must not expose a slap-to-move control.`);
  }

  if (localChrome.includes('ChessClock3DView') || localChrome.includes('createChessClock3D')) {
    errors.push('LocalMatchChrome must not render or instantiate the 3D clock.');
  }
  if (localChrome.includes('PhysicalChessClock')) errors.push('LocalMatchChrome must not render the retired PhysicalChessClock component.');

  if (!local.includes('useLocalGameController')) errors.push('AI 2D play must consume the shared local clock/game controller.');
  if (!premium.includes('useLocalGameController')) errors.push('Premium AI play must consume the same shared local clock/game controller.');

  const onlineUsesAuthoritativeSession =
    online.includes('authoritativeRoomSession(snapshot)')
    && online.includes('clockOwner(gameSession)')
    && online.includes('gameSession.clocks.whiteMs')
    && online.includes('gameSession.clocks.blackMs')
    && online.includes('activeColor={activeColor}');
  if (!onlineUsesAuthoritativeSession) errors.push('Online clock must consume active side and remaining time from the authoritative GameSessionModel.');

  const forbiddenLegacyOnlineClockReads = [
    'snapshot.activeClock',
    'snapshot.awaitingClockPress',
    'snapshot.whiteClockMs',
    'snapshot.blackClockMs',
  ].filter(token => online.includes(token));
  if (forbiddenLegacyOnlineClockReads.length) {
    errors.push(`Online clock must not derive state from legacy room aliases: ${forbiddenLegacyOnlineClockReads.join(', ')}.`);
  }

  if (!localController.includes('CLOCK_TRANSFERRED')) errors.push('Local game controller must retain an automatic clock-transfer path after local moves.');
}

if (errors.length) {
  console.error('\nQQURZ clock-system check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('QQURZ clock system OK: 2D player clocks, authoritative online timing, no 3D clock UI, no slap-to-move control.');
