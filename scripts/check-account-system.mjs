import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const errors = [];

const server = read('server/src/accounts.ts');
const rating = read('server/src/rating.ts');
const timeControls = read('shared/timeControl.ts');
const client = read('src/account/client.ts');
const ui = read('src/profile/ProfileHub.tsx');
const ratingUi = read('src/profile/RatingIdentity.tsx');
const rooms = read('server/src/index.ts');
const matchmaking = read('server/src/matchmaker.ts');
const tournaments = read('server/src/tournaments.ts');
const gateway = read('server/src/gateway.ts');
const wrangler = read('server/wrangler.jsonc');

for (const endpoint of [
  '/account/register', '/account/login', '/account/logout', '/account/me', '/account/profile',
  '/account/password', '/account/notifications', '/account/privacy', '/account/block', '/account/unblock',
  '/account/blocked', '/account/sessions', '/account/sessions/revoke', '/account/sessions/revoke-others',
  '/account/forgot-password', '/account/reset-password', '/account/verify-email', '/account/resend-verification',
  '/account/delete', '/account/social-status',
]) if (!server.includes(endpoint)) errors.push(`Account server is missing ${endpoint}.`);

for (const securityMarker of ['PBKDF2', 'SHA-256', 'PBKDF2_ITERATIONS', 'tokenHash', 'constantTimeEqual', 'lockUntil']) {
  if (!server.includes(securityMarker)) errors.push(`Account security implementation is missing ${securityMarker}.`);
}

for (const modelMarker of ['ratingModel', 'chess960Ratings', 'ratingClass', 'ratingDeviationBefore', 'ratingDeviationAfter', 'gameHistory', 'tournamentHistory', 'trophies', 'blockedPlayerIds', 'notifications', 'privacy', 'sessions']) {
  if (!server.includes(modelMarker)) errors.push(`Account model is missing ${modelMarker}.`);
}

for (const glickoMarker of ['GLICKO2_SCALE', 'DEFAULT_DEVIATION', 'DEFAULT_VOLATILITY', 'nextVolatility', 'rateGlicko2', 'provisional', 'lastRatedAt']) {
  if (!rating.includes(glickoMarker)) errors.push(`Glicko-2 implementation is missing ${glickoMarker}.`);
}
for (const ratingClass of ['rapid', 'blitz', 'bullet']) {
  if (!server.includes(`${ratingClass}:`) || !client.includes(`'${ratingClass}'`) || !ratingUi.includes(`${ratingClass}:`)) {
    errors.push(`Chess960 ${ratingClass} rating is not wired through server, client and profile UI.`);
  }
}
if (!timeControls.includes('ratingClassForTimeControl') || !server.includes('ratingClassForTimeControl')) {
  errors.push('Rated games are not classified by authoritative time control.');
}
if (!server.includes('rateGlicko2(whiteBefore, blackBefore') || !server.includes('rateGlicko2(blackBefore, whiteBefore')) {
  errors.push('Both players must be rated from the same pre-game Glicko-2 snapshot.');
}
if (server.includes('const K = 32') || server.includes('this.expected(')) {
  errors.push('Legacy manual Elo/K-factor rating increments must not be used.');
}

for (const clientMethod of ['registerAccount', 'loginAccount', 'logoutAccount', 'forgotPassword', 'verifyEmail', 'deleteAccount', 'listAccountSessions', 'listBlockedPlayers']) {
  if (!client.includes(`function ${clientMethod}`)) errors.push(`Account client is missing ${clientMethod}().`);
}

for (const uiMarker of ['GAME HISTORY', 'TOURNAMENT HISTORY', 'TROPHY CABINET', 'NOTIFICATIONS', 'PRIVACY', 'BLOCKED PLAYERS', 'SESSIONS & DEVICES', 'Delete my account']) {
  if (!ui.includes(uiMarker)) errors.push(`Account center is missing ${uiMarker}.`);
}
for (const identityMarker of ['CHESS960 RATINGS', 'Competitive identity', 'Glicko-2', 'Provisional', 'RD ']) {
  if (!ratingUi.includes(identityMarker)) errors.push(`Chess-first rating identity is missing ${identityMarker}.`);
}

if (!rooms.includes('resolveAccountSession') || !rooms.includes('recordAccountGame') || !rooms.includes('accountResultRecordedAt')) {
  errors.push('Online rooms are not bound to authenticated accounts and server-written game history.');
}
if (!matchmaking.includes('accountId') || !matchmaking.includes('resolveAccountSession')) errors.push('Random matchmaking is not account-aware.');
if (!tournaments.includes('recordAccountTournament') || !tournaments.includes('accountId')) errors.push('Tournament registration is not account-aware.');
if (!gateway.includes('handleAccountRequest') || !gateway.includes('authorization')) errors.push('Gateway is not routing account auth with authorization CORS.');
if (!wrangler.includes('"ACCOUNTS"') || !wrangler.includes('"AccountRegistry"')) errors.push('AccountRegistry Durable Object binding is missing.');

if (!server.includes("return json({ google: false, apple: false, ordinaryAuthRequired: true })")) {
  errors.push('Apple/Google must stay disabled until ordinary authentication is proven reliable.');
}
if (server.includes('password: body.password') || server.includes('password: String(body.password)')) errors.push('Possible plaintext password persistence detected.');

if (errors.length) {
  console.error('\nQQURZ account-system check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  console.error('');
  process.exit(1);
}

console.log('QQURZ account system OK: server-owned profiles use separate Chess960 Rapid, Blitz and Bullet Glicko-2 ratings with RD/provisional state; auth, history, privacy, blocks, sessions and deletion remain wired.');
