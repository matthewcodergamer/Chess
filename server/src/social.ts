import { resolveAccountSession, type AccountEnv } from './accounts';
import { NotificationAccountRegistry } from './notifications';

type SocialAccount = Record<string, any> & {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  avatarImage?: string | null;
  countryCode?: string;
  rating?: number;
  gamesPlayed?: number;
  privacy?: { profileVisibility?: 'public' | 'players' | 'private'; showCountry?: boolean; showHistory?: boolean; allowChallenges?: boolean };
  blockedPlayerIds?: string[];
  followingPlayerIds?: string[];
  friendPlayerIds?: string[];
  incomingFriendRequestIds?: string[];
  outgoingFriendRequestIds?: string[];
  gameHistory?: Array<{ id: string; roomCode: string; playedAt: number; opponentAccountId: string | null; opponentName: string; baseMs: number; incrementMs: number; positionId: number | null; outcome: 'win' | 'loss' | 'draw'; result: string }>;
};

type SocialPlayer = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  avatarImage: string | null;
  countryCode: string;
  rating: number;
  gamesPlayed: number;
  profileVisible: boolean;
  canChallenge: boolean;
  relationship: { following: boolean; friend: boolean; incomingRequest: boolean; outgoingRequest: boolean };
};

const MAX_CONNECTIONS = 500;
const MAX_REQUESTS = 200;
const MAX_SEARCH = 20;
const MAX_RECENT = 30;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function clean(value: unknown, max = 240): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function ids(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => clean(item, 80)).filter(Boolean))].slice(0, limit);
}
function normalizeSocial(account: SocialAccount): SocialAccount {
  account.followingPlayerIds = ids(account.followingPlayerIds, MAX_CONNECTIONS);
  account.friendPlayerIds = ids(account.friendPlayerIds, MAX_CONNECTIONS);
  account.incomingFriendRequestIds = ids(account.incomingFriendRequestIds, MAX_REQUESTS);
  account.outgoingFriendRequestIds = ids(account.outgoingFriendRequestIds, MAX_REQUESTS);
  account.blockedPlayerIds = ids(account.blockedPlayerIds, 500);
  return account;
}
function blocked(account: SocialAccount, otherId: string): boolean {
  return ids(account.blockedPlayerIds, 500).includes(otherId);
}
function relation(actor: SocialAccount, targetId: string) {
  normalizeSocial(actor);
  return {
    following: actor.followingPlayerIds!.includes(targetId),
    friend: actor.friendPlayerIds!.includes(targetId),
    incomingRequest: actor.incomingFriendRequestIds!.includes(targetId),
    outgoingRequest: actor.outgoingFriendRequestIds!.includes(targetId),
  };
}
function view(actor: SocialAccount, target: SocialAccount, context: 'search' | 'connection' | 'recent' | 'lookup'): SocialPlayer | null {
  if (blocked(actor, target.id) || blocked(target, actor.id)) return null;
  const relationship = relation(actor, target.id);
  const privateProfile = target.privacy?.profileVisibility === 'private';
  if (privateProfile && context !== 'recent' && context !== 'connection' && !relationship.friend) return null;
  const full = !privateProfile || relationship.friend || actor.id === target.id;
  return {
    id: target.id,
    username: target.username,
    displayName: target.displayName,
    avatar: clean(target.avatar, 8) || '♞',
    avatarImage: typeof target.avatarImage === 'string' ? target.avatarImage : null,
    countryCode: full && target.privacy?.showCountry !== false ? clean(target.countryCode, 2).toUpperCase() : '',
    rating: full ? Math.round(Number(target.rating) || 1500) : 0,
    gamesPlayed: full && target.privacy?.showHistory !== false ? Math.max(0, Math.floor(Number(target.gamesPlayed) || 0)) : 0,
    profileVisible: full,
    canChallenge: target.privacy?.allowChallenges !== false,
    relationship,
  };
}
function accountStub(env: AccountEnv): DurableObjectStub {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('qqurz-global-account-registry-v1'));
}

export async function handleSocialRequest(request: Request, env: AccountEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/social')) return null;
  const identity = await resolveAccountSession(request, env);
  if (!identity) return json({ error: 'Sign in to use player discovery.' }, 401);
  const target = new URL(`https://accounts.internal/internal/social${url.pathname.slice('/social'.length)}${url.search}`);
  target.searchParams.set('actorId', identity.id);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  return accountStub(env).fetch(new Request(target, { method: request.method, headers: { 'content-type': 'application/json' }, body }));
}

export class SocialAccountRegistry extends NotificationAccountRegistry {
  private socialStorage(): DurableObjectStorage {
    return (this as unknown as { ctx: DurableObjectState }).ctx.storage;
  }
  private async account(id: string): Promise<SocialAccount | null> {
    const value = id ? await this.socialStorage().get<SocialAccount>(`account:${id}`) : null;
    return value ? normalizeSocial(value) : null;
  }
  private async save(...accounts: SocialAccount[]): Promise<void> {
    const now = Date.now();
    const rows: Record<string, SocialAccount> = {};
    for (const account of accounts) {
      normalizeSocial(account);
      account.updatedAt = now;
      rows[`account:${account.id}`] = account;
    }
    if (accounts.length) await this.socialStorage().put(rows);
  }
  private actor(url: URL): Promise<SocialAccount | null> {
    return this.account(clean(url.searchParams.get('actorId'), 80));
  }
  private async target(body: Record<string, unknown>): Promise<SocialAccount | null> {
    const accountId = clean(body.accountId, 80);
    if (accountId) return this.account(accountId);
    const username = clean(body.username, 20).toLowerCase();
    const id = username ? await this.socialStorage().get<string>(`username:${username}`) : null;
    return id ? this.account(id) : null;
  }
  private available(actor: SocialAccount, target: SocialAccount | null): target is SocialAccount {
    return Boolean(target && target.id !== actor.id && !blocked(actor, target.id) && !blocked(target, actor.id));
  }
  private async listProfiles(actor: SocialAccount, values: string[]): Promise<SocialPlayer[]> {
    const result: SocialPlayer[] = [];
    for (const id of values) {
      const target = await this.account(id);
      if (!target) continue;
      const player = view(actor, target, 'connection');
      if (player) result.push(player);
    }
    return result;
  }
  private async overview(url: URL): Promise<Response> {
    const actor = await this.actor(url);
    if (!actor) return json({ error: 'Player account not found.' }, 404);
    const recent: Array<SocialPlayer & { lastGame: Record<string, unknown> }> = [];
    const seen = new Set<string>();
    for (const game of actor.gameHistory ?? []) {
      const id = game.opponentAccountId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const target = await this.account(id);
      if (!target) continue;
      const player = view(actor, target, 'recent');
      if (!player) continue;
      recent.push({ ...player, lastGame: { id: game.id, roomCode: game.roomCode, playedAt: game.playedAt, baseMs: game.baseMs, incrementMs: game.incrementMs, positionId: game.positionId, outcome: game.outcome, result: game.result } });
      if (recent.length >= MAX_RECENT) break;
    }
    return json({
      friends: await this.listProfiles(actor, actor.friendPlayerIds!),
      following: await this.listProfiles(actor, actor.followingPlayerIds!),
      incomingRequests: await this.listProfiles(actor, actor.incomingFriendRequestIds!),
      outgoingRequests: await this.listProfiles(actor, actor.outgoingFriendRequestIds!),
      recentOpponents: recent,
    });
  }
  private async search(url: URL): Promise<Response> {
    const actor = await this.actor(url);
    if (!actor) return json({ error: 'Player account not found.' }, 404);
    const query = clean(url.searchParams.get('q'), 40).toLowerCase();
    if (query.length < 2) return json({ players: [] });
    const rows = await this.socialStorage().list<SocialAccount>({ prefix: 'account:', limit: 1000 });
    const matches: Array<{ player: SocialPlayer; order: number }> = [];
    for (const raw of rows.values()) {
      const target = normalizeSocial(raw);
      if (target.id === actor.id) continue;
      const username = target.username.toLowerCase();
      const displayName = target.displayName.toLowerCase();
      if (!username.includes(query) && !displayName.includes(query)) continue;
      const player = view(actor, target, 'search');
      if (!player) continue;
      matches.push({ player, order: username === query ? 0 : username.startsWith(query) ? 1 : displayName.startsWith(query) ? 2 : 3 });
    }
    matches.sort((a, b) => a.order - b.order || a.player.username.localeCompare(b.player.username));
    return json({ players: matches.slice(0, MAX_SEARCH).map(item => item.player) });
  }
  private async lookup(request: Request, url: URL): Promise<Response> {
    const actor = await this.actor(url);
    if (!actor) return json({ error: 'Player account not found.' }, 404);
    const body = await request.json().catch(() => ({})) as { accountIds?: unknown };
    const players: SocialPlayer[] = [];
    for (const id of ids(body.accountIds, 100)) {
      const target = await this.account(id);
      if (!target || target.id === actor.id) continue;
      const player = view(actor, target, 'lookup');
      if (player) players.push(player);
    }
    return json({ players });
  }
  private async follow(request: Request, url: URL): Promise<Response> {
    const actor = await this.actor(url);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (!actor) return json({ error: 'Player account not found.' }, 404);
    const target = await this.target(body);
    if (!this.available(actor, target)) return json({ error: 'That player is unavailable.' }, 404);
    if (target.privacy?.profileVisibility === 'private' && !relation(actor, target.id).friend) return json({ error: 'That player keeps their profile private.' }, 403);
    actor.followingPlayerIds = body.follow === false ? actor.followingPlayerIds!.filter(id => id !== target.id) : [target.id, ...actor.followingPlayerIds!.filter(id => id !== target.id)].slice(0, MAX_CONNECTIONS);
    await this.save(actor);
    return json({ player: view(actor, target, 'connection') });
  }
  private async requestFriend(request: Request, url: URL): Promise<Response> {
    const actor = await this.actor(url);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (!actor) return json({ error: 'Player account not found.' }, 404);
    const target = await this.target(body);
    if (!this.available(actor, target)) return json({ error: 'That player is unavailable.' }, 404);
    if (actor.friendPlayerIds!.includes(target.id)) return json({ player: view(actor, target, 'connection'), alreadyFriends: true });
    if (actor.incomingFriendRequestIds!.includes(target.id)) {
      actor.friendPlayerIds = [target.id, ...actor.friendPlayerIds!.filter(id => id !== target.id)].slice(0, MAX_CONNECTIONS);
      target.friendPlayerIds = [actor.id, ...target.friendPlayerIds!.filter(id => id !== actor.id)].slice(0, MAX_CONNECTIONS);
      actor.incomingFriendRequestIds = actor.incomingFriendRequestIds!.filter(id => id !== target.id);
      actor.outgoingFriendRequestIds = actor.outgoingFriendRequestIds!.filter(id => id !== target.id);
      target.incomingFriendRequestIds = target.incomingFriendRequestIds!.filter(id => id !== actor.id);
      target.outgoingFriendRequestIds = target.outgoingFriendRequestIds!.filter(id => id !== actor.id);
      await this.save(actor, target);
      return json({ player: view(actor, target, 'connection'), accepted: true });
    }
    actor.outgoingFriendRequestIds = [target.id, ...actor.outgoingFriendRequestIds!.filter(id => id !== target.id)].slice(0, MAX_REQUESTS);
    target.incomingFriendRequestIds = [actor.id, ...target.incomingFriendRequestIds!.filter(id => id !== actor.id)].slice(0, MAX_REQUESTS);
    await this.save(actor, target);
    return json({ player: view(actor, target, 'connection'), requested: true }, 201);
  }
  private async respondFriend(request: Request, url: URL): Promise<Response> {
    const actor = await this.actor(url);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (!actor) return json({ error: 'Player account not found.' }, 404);
    const target = await this.target(body);
    if (!target || !actor.incomingFriendRequestIds!.includes(target.id)) return json({ error: 'Friend request not found.' }, 404);
    actor.incomingFriendRequestIds = actor.incomingFriendRequestIds!.filter(id => id !== target.id);
    target.outgoingFriendRequestIds = target.outgoingFriendRequestIds!.filter(id => id !== actor.id);
    if (body.action === 'accept' && this.available(actor, target)) {
      actor.friendPlayerIds = [target.id, ...actor.friendPlayerIds!.filter(id => id !== target.id)].slice(0, MAX_CONNECTIONS);
      target.friendPlayerIds = [actor.id, ...target.friendPlayerIds!.filter(id => id !== actor.id)].slice(0, MAX_CONNECTIONS);
    }
    await this.save(actor, target);
    return json({ player: view(actor, target, 'connection'), accepted: body.action === 'accept' });
  }
  private async removeFriend(request: Request, url: URL): Promise<Response> {
    const actor = await this.actor(url);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (!actor) return json({ error: 'Player account not found.' }, 404);
    const target = await this.target(body);
    if (!target) return json({ error: 'Player not found.' }, 404);
    actor.friendPlayerIds = actor.friendPlayerIds!.filter(id => id !== target.id);
    actor.outgoingFriendRequestIds = actor.outgoingFriendRequestIds!.filter(id => id !== target.id);
    target.friendPlayerIds = target.friendPlayerIds!.filter(id => id !== actor.id);
    target.incomingFriendRequestIds = target.incomingFriendRequestIds!.filter(id => id !== actor.id);
    await this.save(actor, target);
    return json({ ok: true });
  }
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/social/overview' && request.method === 'GET') return this.overview(url);
    if (url.pathname === '/internal/social/search' && request.method === 'GET') return this.search(url);
    if (url.pathname === '/internal/social/lookup' && request.method === 'POST') return this.lookup(request, url);
    if (url.pathname === '/internal/social/follow' && request.method === 'POST') return this.follow(request, url);
    if (url.pathname === '/internal/social/friend-request' && request.method === 'POST') return this.requestFriend(request, url);
    if (url.pathname === '/internal/social/friend-request/respond' && request.method === 'POST') return this.respondFriend(request, url);
    if (url.pathname === '/internal/social/friend/remove' && request.method === 'POST') return this.removeFriend(request, url);
    return super.fetch(request);
  }
}
