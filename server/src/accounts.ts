import { DurableObject } from 'cloudflare:workers';

export type AccountEnv = {
  ACCOUNTS: DurableObjectNamespace<AccountRegistry>;
  PUBLIC_SITE_URL?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

type PrivacySettings = {
  profileVisibility: 'public' | 'players' | 'private';
  showCountry: boolean;
  showHistory: boolean;
  allowChallenges: boolean;
};

type NotificationSettings = {
  gameInvites: boolean;
  tournamentUpdates: boolean;
  results: boolean;
  productUpdates: boolean;
};

type AccountSettings = {
  language: string;
  timezone: string;
};

type AccountGame = {
  id: string;
  roomCode: string;
  playedAt: number;
  color: 'white' | 'black';
  opponentName: string;
  opponentAccountId: string | null;
  result: string;
  resultKind: string | null;
  outcome: 'win' | 'loss' | 'draw';
  rated: boolean;
  ratingBefore: number;
  ratingAfter: number;
  chess960RatingBefore: number;
  chess960RatingAfter: number;
  positionId: number | null;
  baseMs: number;
  incrementMs: number;
  moveCount: number;
};

type TournamentHistoryItem = {
  id: string;
  tournamentId: string;
  name: string;
  registeredAt: number;
  status: 'registered' | 'in_progress' | 'complete';
  placement: number | null;
};

type Trophy = {
  id: string;
  title: string;
  tournamentId: string | null;
  placement: number | null;
  awardedAt: number;
};

type SessionRecord = {
  id: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
  ipPrefix: string;
  deviceName: string;
};

type AccountRecord = {
  id: string;
  email: string;
  emailVerifiedAt: number | null;
  username: string;
  displayName: string;
  countryCode: string;
  avatar: string;
  avatarImage: string | null;
  rating: number;
  chess960Rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  createdAt: number;
  updatedAt: number;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  failedLoginCount: number;
  lockUntil: number | null;
  privacy: PrivacySettings;
  notifications: NotificationSettings;
  settings: AccountSettings;
  blockedPlayerIds: string[];
  gameHistory: AccountGame[];
  tournamentHistory: TournamentHistoryItem[];
  trophies: Trophy[];
  sessions: Record<string, SessionRecord>;
};

type PublicAccount = Omit<AccountRecord, 'passwordHash' | 'passwordSalt' | 'passwordIterations' | 'failedLoginCount' | 'lockUntil' | 'sessions'> & {
  sessionCount: number;
};

type TokenRecord = { accountId: string; expiresAt: number };

type GameResultInput = {
  id: string;
  roomCode: string;
  playedAt: number;
  white: { accountId: string | null; name: string };
  black: { accountId: string | null; name: string };
  winner: 'white' | 'black' | null;
  result: string;
  resultKind: string | null;
  positionId: number | null;
  baseMs: number;
  incrementMs: number;
  moveCount: number;
};

type TournamentEventInput = {
  accountId: string;
  tournamentId: string;
  name: string;
  registeredAt?: number;
  status?: TournamentHistoryItem['status'];
  placement?: number | null;
};

const PBKDF2_ITERATIONS = 210_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_HISTORY = 200;
const MAX_TOURNAMENT_HISTORY = 100;
const MAX_TROPHIES = 100;
const MAX_AVATAR_IMAGE_LENGTH = 96_000;
const DEFAULT_PRIVACY: PrivacySettings = { profileVisibility: 'public', showCountry: true, showHistory: true, allowChallenges: true };
const DEFAULT_NOTIFICATIONS: NotificationSettings = { gameInvites: true, tournamentUpdates: true, results: true, productUpdates: false };
const DEFAULT_SETTINGS: AccountSettings = { language: 'en', timezone: 'auto' };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().slice(0, 254);
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
}

function validUsername(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,20}$/.test(value);
}

function normalizeDisplayName(value: unknown, fallback: string): string {
  const cleaned = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return cleaned || fallback;
}

function normalizeCountry(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function normalizeAvatar(value: unknown): string {
  const avatar = String(value ?? '♞').trim().slice(0, 8);
  return avatar || '♞';
}

function normalizeAvatarImage(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (value.length > MAX_AVATAR_IMAGE_LENGTH) return null;
  return /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordHash(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBuffer = Uint8Array.from(salt).buffer;
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function passwordValid(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) return false;
  return /[A-Za-z]/.test(value) && /\d/.test(value);
}

function deviceName(userAgent: string): string {
  if (/iphone|ipad/i.test(userAgent)) return 'iPhone / iPad';
  if (/android/i.test(userAgent)) return 'Android device';
  if (/macintosh|mac os/i.test(userAgent)) return 'Mac';
  if (/windows/i.test(userAgent)) return 'Windows PC';
  if (/linux/i.test(userAgent)) return 'Linux device';
  return 'Browser session';
}

function ipPrefix(value: string): string {
  if (!value) return '';
  if (value.includes(':')) return value.split(':').slice(0, 4).join(':') + '::';
  const parts = value.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : '';
}

function publicAccount(account: AccountRecord): PublicAccount {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, passwordIterations: _passwordIterations, failedLoginCount: _failed, lockUntil: _lock, sessions, ...rest } = account;
  return { ...rest, sessionCount: Object.keys(sessions).length };
}

function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? '';
}

function requestContext(request: Request): { userAgent: string; ip: string } {
  return {
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 240),
    ip: (request.headers.get('x-qqurz-client-ip') ?? '').slice(0, 80),
  };
}

function accountStub(env: AccountEnv): DurableObjectStub<AccountRegistry> {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('qqurz-global-account-registry-v1'));
}

async function sendEmail(env: AccountEnv, to: string, subject: string, html: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function verificationEmailHtml(url: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:auto"><h1>Verify your QQURZ account</h1><p>Confirm this email address to finish protecting your player account.</p><p><a href="${url}" style="display:inline-block;padding:14px 20px;background:#81b64c;color:#17200f;text-decoration:none;border-radius:10px;font-weight:700">Verify email</a></p><p>This link expires in 24 hours.</p></div>`;
}

function resetEmailHtml(url: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:auto"><h1>Reset your QQURZ password</h1><p>Use this one-time link to choose a new password.</p><p><a href="${url}" style="display:inline-block;padding:14px 20px;background:#81b64c;color:#17200f;text-decoration:none;border-radius:10px;font-weight:700">Reset password</a></p><p>This link expires in 60 minutes. If you did not request it, you can ignore this email.</p></div>`;
}

export async function handleAccountRequest(request: Request, env: AccountEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/account/')) return null;
  const target = new URL(`https://accounts.internal${url.pathname}${url.search}`);
  const headers = new Headers();
  headers.set('content-type', request.headers.get('content-type') ?? 'application/json');
  const auth = request.headers.get('authorization');
  if (auth) headers.set('authorization', auth);
  const ua = request.headers.get('user-agent');
  if (ua) headers.set('user-agent', ua);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-qqurz-client-ip', ip);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  return accountStub(env).fetch(new Request(target, { method: request.method, headers, body }));
}

export async function resolveAccountSession(request: Request, env: AccountEnv): Promise<{ id: string; username: string; displayName: string } | null> {
  const token = bearer(request);
  if (!token) return null;
  const response = await accountStub(env).fetch(new Request('https://accounts.internal/internal/resolve', { headers: { authorization: `Bearer ${token}`, 'user-agent': request.headers.get('user-agent') ?? '' } }));
  if (!response.ok) return null;
  return response.json() as Promise<{ id: string; username: string; displayName: string }>;
}

export async function recordAccountGame(env: AccountEnv, game: GameResultInput): Promise<void> {
  await accountStub(env).fetch(new Request('https://accounts.internal/internal/game-result', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(game),
  }));
}

export async function recordAccountTournament(env: AccountEnv, event: TournamentEventInput): Promise<void> {
  await accountStub(env).fetch(new Request('https://accounts.internal/internal/tournament', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
  }));
}

export class AccountRegistry extends DurableObject<AccountEnv> {
  constructor(ctx: DurableObjectState, env: AccountEnv) {
    super(ctx, env);
  }

  private async getAccount(id: string): Promise<AccountRecord | null> {
    return (await this.ctx.storage.get<AccountRecord>(`account:${id}`)) ?? null;
  }

  private async putAccount(account: AccountRecord): Promise<void> {
    account.updatedAt = Date.now();
    await this.ctx.storage.put(`account:${account.id}`, account);
  }

  private async accountIdByEmail(email: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`email:${email}`)) ?? null;
  }

  private async accountIdByUsername(username: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`username:${username.toLowerCase()}`)) ?? null;
  }

  private async createSession(account: AccountRecord, request: Request): Promise<{ token: string; session: SessionRecord }> {
    const token = bytesToBase64Url(randomBytes(32));
    const id = crypto.randomUUID();
    const now = Date.now();
    const context = requestContext(request);
    const session: SessionRecord = {
      id,
      tokenHash: await sha256(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS,
      userAgent: context.userAgent,
      ipPrefix: ipPrefix(context.ip),
      deviceName: deviceName(context.userAgent),
    };
    account.sessions[id] = session;
    await this.ctx.storage.put(`session:${session.tokenHash}`, { accountId: account.id, sessionId: id });
    await this.putAccount(account);
    return { token, session };
  }

  private async revokeSession(account: AccountRecord, sessionId: string): Promise<boolean> {
    const session = account.sessions[sessionId];
    if (!session) return false;
    delete account.sessions[sessionId];
    await this.ctx.storage.delete(`session:${session.tokenHash}`);
    return true;
  }

  private async authenticate(request: Request, touch = true): Promise<{ account: AccountRecord; session: SessionRecord } | null> {
    const token = bearer(request);
    if (!token) return null;
    const tokenHash = await sha256(token);
    const lookup = await this.ctx.storage.get<{ accountId: string; sessionId: string }>(`session:${tokenHash}`);
    if (!lookup) return null;
    const account = await this.getAccount(lookup.accountId);
    if (!account) {
      await this.ctx.storage.delete(`session:${tokenHash}`);
      return null;
    }
    const session = account.sessions[lookup.sessionId];
    if (!session || session.tokenHash !== tokenHash || session.expiresAt <= Date.now()) {
      if (session) delete account.sessions[lookup.sessionId];
      await this.ctx.storage.delete(`session:${tokenHash}`);
      await this.putAccount(account);
      return null;
    }
    if (touch && Date.now() - session.lastSeenAt > 60_000) {
      session.lastSeenAt = Date.now();
      session.expiresAt = Date.now() + SESSION_TTL_MS;
      await this.putAccount(account);
    }
    return { account, session };
  }

  private async issueToken(kind: 'verify' | 'reset', account: AccountRecord, ttlMs: number): Promise<string> {
    const token = bytesToBase64Url(randomBytes(32));
    const hash = await sha256(token);
    await this.ctx.storage.put(`${kind}:${hash}`, { accountId: account.id, expiresAt: Date.now() + ttlMs } satisfies TokenRecord);
    return token;
  }

  private async consumeToken(kind: 'verify' | 'reset', token: string): Promise<AccountRecord | null> {
    if (!token || token.length > 200) return null;
    const hash = await sha256(token);
    const key = `${kind}:${hash}`;
    const record = await this.ctx.storage.get<TokenRecord>(key);
    await this.ctx.storage.delete(key);
    if (!record || record.expiresAt <= Date.now()) return null;
    return this.getAccount(record.accountId);
  }

  private async sendVerification(account: AccountRecord): Promise<boolean> {
    const token = await this.issueToken('verify', account, EMAIL_TOKEN_TTL_MS);
    const site = (this.env.PUBLIC_SITE_URL ?? 'https://qqurzchess.com').replace(/\/$/, '');
    const url = `${site}/?verify=${encodeURIComponent(token)}`;
    return sendEmail(this.env, account.email, 'Verify your QQURZ account', verificationEmailHtml(url));
  }

  private async sendReset(account: AccountRecord): Promise<boolean> {
    const token = await this.issueToken('reset', account, RESET_TOKEN_TTL_MS);
    const site = (this.env.PUBLIC_SITE_URL ?? 'https://qqurzchess.com').replace(/\/$/, '');
    const url = `${site}/?reset=${encodeURIComponent(token)}`;
    return sendEmail(this.env, account.email, 'Reset your QQURZ password', resetEmailHtml(url));
  }

  private async verifyPassword(account: AccountRecord, password: string): Promise<boolean> {
    const candidate = await passwordHash(password, base64ToBytes(account.passwordSalt), account.passwordIterations);
    return constantTimeEqual(candidate, account.passwordHash);
  }

  private async register(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const username = normalizeUsername(body.username);
    if (!validEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (!validUsername(username)) return json({ error: 'Username must be 3–20 letters, numbers, underscores or hyphens.' }, 400);
    if (!passwordValid(body.password)) return json({ error: 'Password must be 10–128 characters and contain letters and numbers.' }, 400);
    if (await this.accountIdByEmail(email)) return json({ error: 'An account already uses that email address.' }, 409);
    if (await this.accountIdByUsername(username)) return json({ error: 'That username is already taken.' }, 409);

    const salt = randomBytes(16);
    const now = Date.now();
    const id = crypto.randomUUID();
    const account: AccountRecord = {
      id,
      email,
      emailVerifiedAt: null,
      username,
      displayName: normalizeDisplayName(body.displayName, username),
      countryCode: normalizeCountry(body.countryCode),
      avatar: normalizeAvatar(body.avatar),
      avatarImage: normalizeAvatarImage(body.avatarImage),
      rating: 1200,
      chess960Rating: 1200,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      createdAt: now,
      updatedAt: now,
      passwordHash: await passwordHash(String(body.password), salt),
      passwordSalt: bytesToBase64(salt),
      passwordIterations: PBKDF2_ITERATIONS,
      failedLoginCount: 0,
      lockUntil: null,
      privacy: { ...DEFAULT_PRIVACY },
      notifications: { ...DEFAULT_NOTIFICATIONS },
      settings: { ...DEFAULT_SETTINGS },
      blockedPlayerIds: [],
      gameHistory: [],
      tournamentHistory: [],
      trophies: [],
      sessions: {},
    };
    await this.ctx.storage.put({ [`account:${id}`]: account, [`email:${email}`]: id, [`username:${username.toLowerCase()}`]: id });
    const session = await this.createSession(account, request);
    const verificationSent = await this.sendVerification(account);
    return json({ account: publicAccount(account), token: session.token, verificationSent }, 201);
  }

  private async login(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const identifier = String(body.identifier ?? '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    const id = identifier.includes('@') ? await this.accountIdByEmail(normalizeEmail(identifier)) : await this.accountIdByUsername(normalizeUsername(identifier));
    const account = id ? await this.getAccount(id) : null;
    if (!account) return json({ error: 'Incorrect email/username or password.' }, 401);
    const now = Date.now();
    if (account.lockUntil && account.lockUntil > now) return json({ error: 'Too many failed sign-in attempts. Try again later.' }, 429);
    const ok = await this.verifyPassword(account, password);
    if (!ok) {
      account.failedLoginCount += 1;
      account.lockUntil = account.failedLoginCount >= 7 ? now + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(6, account.failedLoginCount - 7)) : null;
      await this.putAccount(account);
      return json({ error: 'Incorrect email/username or password.' }, 401);
    }
    account.failedLoginCount = 0;
    account.lockUntil = null;
    const session = await this.createSession(account, request);
    return json({ account: publicAccount(account), token: session.token });
  }

  private async me(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    return json({ account: publicAccount(auth.account) });
  }

  private async updateProfile(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const account = auth.account;
    if (body.username !== undefined) {
      const username = normalizeUsername(body.username);
      if (!validUsername(username)) return json({ error: 'Username must be 3–20 letters, numbers, underscores or hyphens.' }, 400);
      if (username.toLowerCase() !== account.username.toLowerCase()) {
        if (await this.accountIdByUsername(username)) return json({ error: 'That username is already taken.' }, 409);
        await this.ctx.storage.delete(`username:${account.username.toLowerCase()}`);
        await this.ctx.storage.put(`username:${username.toLowerCase()}`, account.id);
        account.username = username;
      }
    }
    if (body.displayName !== undefined) account.displayName = normalizeDisplayName(body.displayName, account.username);
    if (body.countryCode !== undefined) account.countryCode = normalizeCountry(body.countryCode);
    if (body.avatar !== undefined) account.avatar = normalizeAvatar(body.avatar);
    if (body.avatarImage !== undefined) {
      const image = normalizeAvatarImage(body.avatarImage);
      if (body.avatarImage && !image) return json({ error: 'Profile image must be a small PNG, JPEG or WebP image.' }, 400);
      account.avatarImage = image;
    }
    await this.putAccount(account);
    return json({ account: publicAccount(account) });
  }

  private async changePassword(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const body = await request.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string };
    if (!await this.verifyPassword(auth.account, body.currentPassword ?? '')) return json({ error: 'Current password is incorrect.' }, 403);
    if (!passwordValid(body.newPassword)) return json({ error: 'New password must be 10–128 characters and contain letters and numbers.' }, 400);
    const salt = randomBytes(16);
    auth.account.passwordSalt = bytesToBase64(salt);
    auth.account.passwordHash = await passwordHash(body.newPassword, salt);
    auth.account.passwordIterations = PBKDF2_ITERATIONS;
    for (const sessionId of Object.keys(auth.account.sessions)) {
      if (sessionId !== auth.session.id) await this.revokeSession(auth.account, sessionId);
    }
    await this.putAccount(auth.account);
    return json({ ok: true });
  }

  private async updateNotifications(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const body = await request.json().catch(() => ({})) as Partial<NotificationSettings>;
    for (const key of Object.keys(DEFAULT_NOTIFICATIONS) as Array<keyof NotificationSettings>) {
      if (typeof body[key] === 'boolean') auth.account.notifications[key] = body[key] as boolean;
    }
    await this.putAccount(auth.account);
    return json({ notifications: auth.account.notifications });
  }

  private async updatePrivacy(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const body = await request.json().catch(() => ({})) as Partial<PrivacySettings>;
    if (body.profileVisibility === 'public' || body.profileVisibility === 'players' || body.profileVisibility === 'private') auth.account.privacy.profileVisibility = body.profileVisibility;
    for (const key of ['showCountry', 'showHistory', 'allowChallenges'] as const) if (typeof body[key] === 'boolean') auth.account.privacy[key] = body[key];
    await this.putAccount(auth.account);
    return json({ privacy: auth.account.privacy });
  }

  private async updateSettings(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const body = await request.json().catch(() => ({})) as Partial<AccountSettings>;
    if (typeof body.language === 'string') auth.account.settings.language = body.language.trim().slice(0, 16) || 'en';
    if (typeof body.timezone === 'string') auth.account.settings.timezone = body.timezone.trim().slice(0, 64) || 'auto';
    await this.putAccount(auth.account);
    return json({ settings: auth.account.settings });
  }

  private async blockPlayer(request: Request, unblock = false): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const body = await request.json().catch(() => ({})) as { username?: string };
    const username = normalizeUsername(body.username);
    const targetId = await this.accountIdByUsername(username);
    if (!targetId) return json({ error: 'Player not found.' }, 404);
    if (targetId === auth.account.id) return json({ error: 'You cannot block yourself.' }, 400);
    if (unblock) auth.account.blockedPlayerIds = auth.account.blockedPlayerIds.filter(id => id !== targetId);
    else if (!auth.account.blockedPlayerIds.includes(targetId)) auth.account.blockedPlayerIds = [...auth.account.blockedPlayerIds, targetId].slice(-500);
    await this.putAccount(auth.account);
    return json({ blockedPlayerIds: auth.account.blockedPlayerIds });
  }

  private async blockedPlayers(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const players: Array<{ id: string; username: string; displayName: string; avatar: string; avatarImage: string | null }> = [];
    for (const id of auth.account.blockedPlayerIds) {
      const account = await this.getAccount(id);
      if (account) players.push({ id, username: account.username, displayName: account.displayName, avatar: account.avatar, avatarImage: account.avatarImage });
    }
    return json({ players });
  }

  private async sessions(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const sessions = Object.values(auth.account.sessions).map(session => ({
      id: session.id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      deviceName: session.deviceName,
      userAgent: session.userAgent,
      ipPrefix: session.ipPrefix,
      current: session.id === auth.session.id,
    })).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return json({ sessions });
  }

  private async revokeSessionRoute(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const body = await request.json().catch(() => ({})) as { sessionId?: string };
    if (!body.sessionId) return json({ error: 'Missing session.' }, 400);
    await this.revokeSession(auth.account, body.sessionId);
    await this.putAccount(auth.account);
    return json({ ok: true, currentRevoked: body.sessionId === auth.session.id });
  }

  private async revokeOthers(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    for (const sessionId of Object.keys(auth.account.sessions)) if (sessionId !== auth.session.id) await this.revokeSession(auth.account, sessionId);
    await this.putAccount(auth.account);
    return json({ ok: true });
  }

  private async logout(request: Request): Promise<Response> {
    const auth = await this.authenticate(request, false);
    if (!auth) return json({ ok: true });
    await this.revokeSession(auth.account, auth.session.id);
    await this.putAccount(auth.account);
    return json({ ok: true });
  }

  private async forgotPassword(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as { email?: string };
    const email = normalizeEmail(body.email);
    const id = validEmail(email) ? await this.accountIdByEmail(email) : null;
    const account = id ? await this.getAccount(id) : null;
    if (account) await this.sendReset(account);
    return json({ ok: true, message: 'If that email is registered, a reset link will be sent.' });
  }

  private async resetPassword(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as { token?: string; password?: string };
    if (!passwordValid(body.password)) return json({ error: 'Password must be 10–128 characters and contain letters and numbers.' }, 400);
    const account = await this.consumeToken('reset', body.token ?? '');
    if (!account) return json({ error: 'That reset link is invalid or expired.' }, 400);
    const salt = randomBytes(16);
    account.passwordSalt = bytesToBase64(salt);
    account.passwordHash = await passwordHash(body.password, salt);
    account.passwordIterations = PBKDF2_ITERATIONS;
    for (const sessionId of Object.keys(account.sessions)) await this.revokeSession(account, sessionId);
    await this.putAccount(account);
    return json({ ok: true });
  }

  private async verifyEmail(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as { token?: string };
    const account = await this.consumeToken('verify', body.token ?? '');
    if (!account) return json({ error: 'That verification link is invalid or expired.' }, 400);
    account.emailVerifiedAt = Date.now();
    await this.putAccount(account);
    return json({ ok: true, account: publicAccount(account) });
  }

  private async resendVerification(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    if (auth.account.emailVerifiedAt) return json({ ok: true, alreadyVerified: true });
    const sent = await this.sendVerification(auth.account);
    return json({ ok: true, sent });
  }

  private async deleteAccount(request: Request): Promise<Response> {
    const auth = await this.authenticate(request, false);
    if (!auth) return json({ error: 'Sign in required.' }, 401);
    const body = await request.json().catch(() => ({})) as { password?: string; confirmation?: string };
    if (body.confirmation !== 'DELETE') return json({ error: 'Type DELETE to confirm account deletion.' }, 400);
    if (!await this.verifyPassword(auth.account, body.password ?? '')) return json({ error: 'Password is incorrect.' }, 403);
    for (const sessionId of Object.keys(auth.account.sessions)) await this.revokeSession(auth.account, sessionId);
    await this.ctx.storage.delete([`email:${auth.account.email}`, `username:${auth.account.username.toLowerCase()}`, `account:${auth.account.id}`]);
    return json({ ok: true });
  }

  private async resolveInternal(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (!auth) return json({ error: 'Unauthorized.' }, 401);
    return json({ id: auth.account.id, username: auth.account.username, displayName: auth.account.displayName });
  }

  private outcomeFor(color: 'white' | 'black', winner: GameResultInput['winner']): 'win' | 'loss' | 'draw' {
    return winner === null ? 'draw' : winner === color ? 'win' : 'loss';
  }

  private expected(rating: number, opponent: number): number {
    return 1 / (1 + 10 ** ((opponent - rating) / 400));
  }

  private async recordGameResult(request: Request): Promise<Response> {
    const game = await request.json().catch(() => null) as GameResultInput | null;
    if (!game?.id || !game.roomCode) return json({ error: 'Invalid game result.' }, 400);
    const dedupeKey = `game-recorded:${game.id}`;
    if (await this.ctx.storage.get<boolean>(dedupeKey)) return json({ ok: true, duplicate: true });

    const white = game.white.accountId ? await this.getAccount(game.white.accountId) : null;
    const black = game.black.accountId ? await this.getAccount(game.black.accountId) : null;
    const rated = Boolean(white && black && white.id !== black.id);
    const whiteBefore = white?.rating ?? 1200;
    const blackBefore = black?.rating ?? 1200;
    const white960Before = white?.chess960Rating ?? 1200;
    const black960Before = black?.chess960Rating ?? 1200;
    const scoreWhite = game.winner === null ? .5 : game.winner === 'white' ? 1 : 0;
    const scoreBlack = 1 - scoreWhite;
    const K = 32;
    const whiteAfter = rated ? Math.round(whiteBefore + K * (scoreWhite - this.expected(whiteBefore, blackBefore))) : whiteBefore;
    const blackAfter = rated ? Math.round(blackBefore + K * (scoreBlack - this.expected(blackBefore, whiteBefore))) : blackBefore;
    const white960After = rated ? Math.round(white960Before + K * (scoreWhite - this.expected(white960Before, black960Before))) : white960Before;
    const black960After = rated ? Math.round(black960Before + K * (scoreBlack - this.expected(black960Before, white960Before))) : black960Before;

    const apply = async (account: AccountRecord | null, color: 'white' | 'black', opponent: GameResultInput['white'], ratingBefore: number, ratingAfter: number, rating960Before: number, rating960After: number) => {
      if (!account) return;
      const outcome = this.outcomeFor(color, game.winner);
      account.rating = ratingAfter;
      account.chess960Rating = rating960After;
      account.gamesPlayed += 1;
      if (outcome === 'win') account.wins += 1;
      else if (outcome === 'loss') account.losses += 1;
      else account.draws += 1;
      account.gameHistory = [{
        id: game.id,
        roomCode: game.roomCode,
        playedAt: Number(game.playedAt) || Date.now(),
        color,
        opponentName: opponent.name,
        opponentAccountId: opponent.accountId,
        result: String(game.result ?? '').slice(0, 160),
        resultKind: game.resultKind ? String(game.resultKind).slice(0, 32) : null,
        outcome,
        rated,
        ratingBefore,
        ratingAfter,
        chess960RatingBefore: rating960Before,
        chess960RatingAfter: rating960After,
        positionId: Number.isInteger(game.positionId) ? game.positionId : null,
        baseMs: Math.max(0, Number(game.baseMs) || 0),
        incrementMs: Math.max(0, Number(game.incrementMs) || 0),
        moveCount: Math.max(0, Number(game.moveCount) || 0),
      }, ...account.gameHistory.filter(item => item.id !== game.id)].slice(0, MAX_HISTORY);
      await this.putAccount(account);
    };

    await apply(white, 'white', game.black, whiteBefore, whiteAfter, white960Before, white960After);
    await apply(black, 'black', game.white, blackBefore, blackAfter, black960Before, black960After);
    await this.ctx.storage.put(dedupeKey, true);
    return json({ ok: true, rated });
  }

  private async recordTournament(request: Request): Promise<Response> {
    const event = await request.json().catch(() => null) as TournamentEventInput | null;
    if (!event?.accountId || !event.tournamentId || !event.name) return json({ error: 'Invalid tournament event.' }, 400);
    const account = await this.getAccount(event.accountId);
    if (!account) return json({ error: 'Account not found.' }, 404);
    const existing = account.tournamentHistory.find(item => item.tournamentId === event.tournamentId);
    const item: TournamentHistoryItem = {
      id: existing?.id ?? crypto.randomUUID(),
      tournamentId: event.tournamentId,
      name: event.name.slice(0, 100),
      registeredAt: existing?.registeredAt ?? event.registeredAt ?? Date.now(),
      status: event.status ?? existing?.status ?? 'registered',
      placement: Number.isInteger(event.placement) && Number(event.placement) > 0 ? Number(event.placement) : existing?.placement ?? null,
    };
    account.tournamentHistory = [item, ...account.tournamentHistory.filter(history => history.tournamentId !== event.tournamentId)].slice(0, MAX_TOURNAMENT_HISTORY);
    if (item.status === 'complete' && item.placement && item.placement <= 3) {
      const title = item.placement === 1 ? `${item.name} Champion` : item.placement === 2 ? `${item.name} Runner-up` : `${item.name} Third place`;
      account.trophies = [{ id: `trophy:${item.tournamentId}:${item.placement}`, title, tournamentId: item.tournamentId, placement: item.placement, awardedAt: Date.now() }, ...account.trophies.filter(trophy => trophy.id !== `trophy:${item.tournamentId}:${item.placement}`)].slice(0, MAX_TROPHIES);
    }
    await this.putAccount(account);
    return json({ ok: true });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/internal/resolve' && request.method === 'GET') return this.resolveInternal(request);
    if (path === '/internal/game-result' && request.method === 'POST') return this.recordGameResult(request);
    if (path === '/internal/tournament' && request.method === 'POST') return this.recordTournament(request);

    if (path === '/account/register' && request.method === 'POST') return this.register(request);
    if (path === '/account/login' && request.method === 'POST') return this.login(request);
    if (path === '/account/logout' && request.method === 'POST') return this.logout(request);
    if (path === '/account/me' && request.method === 'GET') return this.me(request);
    if (path === '/account/profile' && request.method === 'POST') return this.updateProfile(request);
    if (path === '/account/password' && request.method === 'POST') return this.changePassword(request);
    if (path === '/account/notifications' && request.method === 'POST') return this.updateNotifications(request);
    if (path === '/account/privacy' && request.method === 'POST') return this.updatePrivacy(request);
    if (path === '/account/settings' && request.method === 'POST') return this.updateSettings(request);
    if (path === '/account/block' && request.method === 'POST') return this.blockPlayer(request, false);
    if (path === '/account/unblock' && request.method === 'POST') return this.blockPlayer(request, true);
    if (path === '/account/blocked' && request.method === 'GET') return this.blockedPlayers(request);
    if (path === '/account/sessions' && request.method === 'GET') return this.sessions(request);
    if (path === '/account/sessions/revoke' && request.method === 'POST') return this.revokeSessionRoute(request);
    if (path === '/account/sessions/revoke-others' && request.method === 'POST') return this.revokeOthers(request);
    if (path === '/account/forgot-password' && request.method === 'POST') return this.forgotPassword(request);
    if (path === '/account/reset-password' && request.method === 'POST') return this.resetPassword(request);
    if (path === '/account/verify-email' && request.method === 'POST') return this.verifyEmail(request);
    if (path === '/account/resend-verification' && request.method === 'POST') return this.resendVerification(request);
    if (path === '/account/delete' && request.method === 'POST') return this.deleteAccount(request);
    if (path === '/account/social-status' && request.method === 'GET') return json({ google: false, apple: false, ordinaryAuthRequired: true });
    return json({ error: 'Not found.' }, 404);
  }
}
