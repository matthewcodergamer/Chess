import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];

function source(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    errors.push(`${file} is missing.`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}

function requireText(file, needles) {
  const text = source(file);
  for (const needle of needles) {
    if (!text.includes(needle)) errors.push(`${file} must preserve the UX-state marker: ${needle}`);
  }
  return text;
}

requireText('src/ui/StateNotice.tsx', ['state-notice', 'state-notice-actions', 'type="button"']);
requireText('src/AppShell.tsx', ['This invite link isn’t valid', 'Create a room', 'Retry server', 'Play local instead']);
requireText('src/game/LocalMatchChrome.tsx', ['Stockfish isn’t available right now', 'Retry Stockfish', 'Play local human']);
requireText('src/ui/MatchPlayerBar.tsx', ['ReconnectCountdown', 'reconnectingOpponent']);
requireText('src/payments/WalletPanel.tsx', ['Payment cancelled', 'No purchase was completed', 'Retry wallet']);
requireText('src/premium/Premium3DGate.tsx', ['No purchase was completed', 'Retry checkout', 'Checkout didn’t open']);
requireText('src/tournaments/TournamentMasterGrid.tsx', ['No tournament seats are open right now', 'next registration window', 'Retry availability', 'Tournament server unavailable']);
requireText('src/tournaments/TournamentLivePanel.tsx', ['Standings haven’t started yet', 'Retry live view', 'Live updates paused']);
requireText('src/multiplayer/RandomMatchmaking.tsx', ['No queue ticket or game room was created', 'Try again', 'The pool is quiet right now']);
requireText('src/notifications/NotificationCenter.tsx', ['Inbox couldn’t refresh', 'Retry inbox', 'You’re caught up.']);

for (const file of [
  'src/payments/WalletPanel.tsx',
  'src/premium/Premium3DGate.tsx',
  'src/tournaments/TournamentMasterGrid.tsx',
  'src/tournaments/TournamentLivePanel.tsx',
  'src/multiplayer/RandomMatchmaking.tsx',
  'src/notifications/NotificationCenter.tsx',
  'src/game/LocalMatchChrome.tsx',
]) {
  const text = source(file);
  if (text.includes('error instanceof Error ? error.message')) {
    errors.push(`${file} must not dump raw caught Error.message text into the user-facing recovery state.`);
  }
}

if (errors.length) {
  console.error('\nQQURZ empty/error-state UX check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  console.error('');
  process.exit(1);
}

console.log('QQURZ state UX OK: actionable empty/error states, retries, cancellation clarity and reconnect recovery are present.');
