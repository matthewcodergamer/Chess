import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceRequired(source, search, replacement, label) {
  if (search instanceof RegExp) {
    if (!search.test(source)) throw new Error(`Missing migration target: ${label}`);
    return source.replace(search, replacement);
  }
  if (!source.includes(search)) throw new Error(`Missing migration target: ${label}`);
  return source.replace(search, replacement);
}

let accounts = read('server/src/accounts.ts');
accounts = replaceRequired(
  accounts,
  "import { DurableObject } from 'cloudflare:workers';",
  "import { DurableObject } from 'cloudflare:workers';\nimport { ratingClassForTimeControl, type Chess960RatingClass } from '../../shared/timeControl';\nimport { createGlicko2Rating, normalizeGlicko2Rating, rateGlicko2, type Glicko2Rating } from './rating';",
  'account rating imports',
);

accounts = replaceRequired(
  accounts,
  "type AccountSettings = {\n  language: string;\n  timezone: string;\n};",
  "type AccountSettings = {\n  language: string;\n  timezone: string;\n};\n\ntype Chess960RatingBook = Record<Chess960RatingClass, Glicko2Rating>;",
  'rating book type',
);

accounts = replaceRequired(
  accounts,
  "  rated: boolean;\n  ratingBefore: number;\n  ratingAfter: number;\n  chess960RatingBefore: number;\n  chess960RatingAfter: number;",
  "  rated: boolean;\n  ratingClass: Chess960RatingClass;\n  ratingBefore: number;\n  ratingAfter: number;\n  ratingDeviationBefore: number;\n  ratingDeviationAfter: number;\n  chess960RatingBefore: number;\n  chess960RatingAfter: number;",
  'game rating metadata',
);

accounts = replaceRequired(
  accounts,
  "  avatar: string;\n  avatarImage: string | null;\n  rating: number;\n  chess960Rating: number;",
  "  avatar: string;\n  avatarImage: string | null;\n  ratingModel: 'glicko2';\n  chess960Ratings: Chess960RatingBook;\n  rating: number;\n  chess960Rating: number;",
  'account rating fields',
);

accounts = replaceRequired(
  accounts,
  "function publicAccount(account: AccountRecord): PublicAccount {",
  `function createRatingBook(seedRating = 1500): Chess960RatingBook {\n  return {\n    rapid: createGlicko2Rating(seedRating),\n    blitz: createGlicko2Rating(seedRating),\n    bullet: createGlicko2Rating(seedRating),\n  };\n}\n\nfunction migrateStoredAccount(raw: unknown): AccountRecord | null {\n  if (!raw || typeof raw !== 'object') return null;\n  const account = raw as AccountRecord & Record<string, any>;\n  if (!account.id || !account.email || !account.username) return null;\n  const legacySeed = Number.isFinite(Number(account.chess960Rating)) ? Number(account.chess960Rating) : 1500;\n  const source = account.chess960Ratings as Partial<Chess960RatingBook> | undefined;\n  account.ratingModel = 'glicko2';\n  account.chess960Ratings = {\n    rapid: normalizeGlicko2Rating(source?.rapid, legacySeed),\n    blitz: normalizeGlicko2Rating(source?.blitz, legacySeed),\n    bullet: normalizeGlicko2Rating(source?.bullet, legacySeed),\n  };\n  account.rating = Math.round(account.chess960Ratings.rapid.rating);\n  account.chess960Rating = Math.round(account.chess960Ratings.rapid.rating);\n  account.gameHistory = Array.isArray(account.gameHistory) ? account.gameHistory.map((game: any) => {\n    const ratingClass: Chess960RatingClass = game.ratingClass === 'rapid' || game.ratingClass === 'blitz' || game.ratingClass === 'bullet'\n      ? game.ratingClass\n      : ratingClassForTimeControl(Number(game.baseMs) || 0, Number(game.incrementMs) || 0);\n    return {\n      ...game,\n      ratingClass,\n      ratingDeviationBefore: Number.isFinite(Number(game.ratingDeviationBefore)) ? Number(game.ratingDeviationBefore) : 350,\n      ratingDeviationAfter: Number.isFinite(Number(game.ratingDeviationAfter)) ? Number(game.ratingDeviationAfter) : 350,\n    };\n  }) : [];\n  account.tournamentHistory = Array.isArray(account.tournamentHistory) ? account.tournamentHistory : [];\n  account.trophies = Array.isArray(account.trophies) ? account.trophies : [];\n  account.blockedPlayerIds = Array.isArray(account.blockedPlayerIds) ? account.blockedPlayerIds : [];\n  account.sessions = account.sessions && typeof account.sessions === 'object' ? account.sessions : {};\n  return account;\n}\n\nfunction publicAccount(account: AccountRecord): PublicAccount {`,
  'stored account migration',
);

accounts = replaceRequired(
  accounts,
  "  private async getAccount(id: string): Promise<AccountRecord | null> {\n    return (await this.ctx.storage.get<AccountRecord>(`account:${id}`)) ?? null;\n  }",
  "  private async getAccount(id: string): Promise<AccountRecord | null> {\n    const raw = await this.ctx.storage.get<unknown>(`account:${id}`);\n    const migrated = migrateStoredAccount(raw);\n    if (migrated && raw && typeof raw === 'object' && (!(raw as Record<string, unknown>).chess960Ratings || (raw as Record<string, unknown>).ratingModel !== 'glicko2')) {\n      await this.ctx.storage.put(`account:${id}`, migrated);\n    }\n    return migrated;\n  }",
  'account storage migration',
);

accounts = replaceRequired(
  accounts,
  "      avatar: normalizeAvatar(body.avatar),\n      avatarImage: normalizeAvatarImage(body.avatarImage),\n      rating: 1200,\n      chess960Rating: 1200,",
  "      avatar: normalizeAvatar(body.avatar),\n      avatarImage: normalizeAvatarImage(body.avatarImage),\n      ratingModel: 'glicko2',\n      chess960Ratings: createRatingBook(),\n      rating: 1500,\n      chess960Rating: 1500,",
  'new account rating defaults',
);

accounts = replaceRequired(
  accounts,
  /\n  private expected\(rating: number, opponent: number\): number \{[\s\S]*?\n  private async recordTournament\(request: Request\): Promise<Response> \{/,
  `\n  private async recordGameResult(request: Request): Promise<Response> {\n    const game = await request.json().catch(() => null) as GameResultInput | null;\n    if (!game?.id || !game.roomCode) return json({ error: 'Invalid game result.' }, 400);\n    const dedupeKey = \`game-recorded:\${game.id}\`;\n    if (await this.ctx.storage.get<boolean>(dedupeKey)) return json({ ok: true, duplicate: true });\n\n    const white = game.white.accountId ? await this.getAccount(game.white.accountId) : null;\n    const black = game.black.accountId ? await this.getAccount(game.black.accountId) : null;\n    const rated = Boolean(white && black && white.id !== black.id);\n    const ratingClass = ratingClassForTimeControl(game.baseMs, game.incrementMs);\n    const playedAt = Number(game.playedAt) || Date.now();\n    const whiteBefore = white?.chess960Ratings[ratingClass] ?? createGlicko2Rating();\n    const blackBefore = black?.chess960Ratings[ratingClass] ?? createGlicko2Rating();\n    const scoreWhite = game.winner === null ? .5 : game.winner === 'white' ? 1 : 0;\n    const scoreBlack = 1 - scoreWhite;\n    const whiteAfter = rated ? rateGlicko2(whiteBefore, blackBefore, scoreWhite, playedAt) : whiteBefore;\n    const blackAfter = rated ? rateGlicko2(blackBefore, whiteBefore, scoreBlack, playedAt) : blackBefore;\n\n    const apply = async (account: AccountRecord | null, color: 'white' | 'black', opponent: GameResultInput['white'], before: Glicko2Rating, after: Glicko2Rating) => {\n      if (!account) return;\n      const outcome = this.outcomeFor(color, game.winner);\n      if (rated) account.chess960Ratings[ratingClass] = after;\n      account.ratingModel = 'glicko2';\n      account.rating = Math.round(account.chess960Ratings.rapid.rating);\n      account.chess960Rating = Math.round(account.chess960Ratings.rapid.rating);\n      account.gamesPlayed += 1;\n      if (outcome === 'win') account.wins += 1;\n      else if (outcome === 'loss') account.losses += 1;\n      else account.draws += 1;\n      account.gameHistory = [{\n        id: game.id,\n        roomCode: game.roomCode,\n        playedAt,\n        color,\n        opponentName: opponent.name,\n        opponentAccountId: opponent.accountId,\n        result: String(game.result ?? '').slice(0, 160),\n        resultKind: game.resultKind ? String(game.resultKind).slice(0, 32) : null,\n        outcome,\n        rated,\n        ratingClass,\n        ratingBefore: before.rating,\n        ratingAfter: after.rating,\n        ratingDeviationBefore: before.deviation,\n        ratingDeviationAfter: after.deviation,\n        chess960RatingBefore: before.rating,\n        chess960RatingAfter: after.rating,\n        positionId: Number.isInteger(game.positionId) ? game.positionId : null,\n        baseMs: Math.max(0, Number(game.baseMs) || 0),\n        incrementMs: Math.max(0, Number(game.incrementMs) || 0),\n        moveCount: Math.max(0, Number(game.moveCount) || 0),\n      }, ...account.gameHistory.filter(item => item.id !== game.id)].slice(0, MAX_HISTORY);\n      await this.putAccount(account);\n    };\n\n    await apply(white, 'white', game.black, whiteBefore, whiteAfter);\n    await apply(black, 'black', game.white, blackBefore, blackAfter);\n    await this.ctx.storage.put(dedupeKey, true);\n    return json({ ok: true, rated, ratingClass });\n  }\n\n  private async recordTournament(request: Request): Promise<Response> {`,
  'Glicko game result writer',
);

write('server/src/accounts.ts', accounts);

let profile = read('src/profile/ProfileHub.tsx');
profile = replaceRequired(
  profile,
  "import { DestructiveButton, PrimaryButton, SecondaryButton, SegmentedControl } from '../ui/controls';",
  "import { DestructiveButton, PrimaryButton, SecondaryButton, SegmentedControl } from '../ui/controls';\nimport RatingIdentity from './RatingIdentity';",
  'rating identity import',
);
profile = replaceRequired(profile, "\n  const winRate = account.gamesPlayed ? Math.round((account.wins / account.gamesPlayed) * 100) : 0;\n", "\n", 'legacy win-rate dashboard');
profile = replaceRequired(profile, '<span className="qqurz-kicker">PLAYER ACCOUNT</span>', '<span className="qqurz-kicker">CHESS960 PLAYER</span>', 'player identity kicker');
profile = replaceRequired(
  profile,
  /          <section className="account-stats" aria-label="Ratings">[\s\S]*?          <\/section>\n/,
  '          <RatingIdentity account={account} />\n',
  'legacy dashboard rating cards',
);
profile = replaceRequired(
  profile,
  "<small>{dateLabel(game.playedAt)} · {timeControl(game.baseMs, game.incrementMs)} · Chess960 #{game.positionId ?? '—'}</small><p>{game.result}</p></div><strong>{game.chess960RatingAfter}{game.rated ? ` ${game.chess960RatingAfter >= game.chess960RatingBefore ? '+' : ''}${game.chess960RatingAfter - game.chess960RatingBefore}` : ''}</strong>",
  "<small>{dateLabel(game.playedAt)} · {timeControl(game.baseMs, game.incrementMs)} · Chess960 {game.ratingClass[0].toUpperCase() + game.ratingClass.slice(1)} · #{game.positionId ?? '—'}</small><p>{game.result}{game.rated ? ` · RD ${Math.round(game.ratingDeviationAfter)}` : ' · Unrated'}</p></div><strong>{Math.round(game.ratingAfter)}{game.rated ? ` ${Math.round(game.ratingAfter - game.ratingBefore) >= 0 ? '+' : ''}${Math.round(game.ratingAfter - game.ratingBefore)}` : ''}</strong>",
  'game-history rating display',
);
write('src/profile/ProfileHub.tsx', profile);

console.log('Migrated QQURZ profiles to server-owned Chess960 Glicko-2 Rapid/Blitz/Bullet ratings.');
