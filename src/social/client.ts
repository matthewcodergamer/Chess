import { ACCOUNT_API, accountToken } from '../account/client';

export type SocialRelationship = {
  following: boolean;
  friend: boolean;
  incomingRequest: boolean;
  outgoingRequest: boolean;
};

export type SocialPlayer = {
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
  relationship: SocialRelationship;
};

export type RecentOpponent = SocialPlayer & {
  lastGame: {
    id: string;
    roomCode: string;
    playedAt: number;
    baseMs: number;
    incrementMs: number;
    positionId: number | null;
    outcome: 'win' | 'loss' | 'draw';
    result: string;
  };
};

export type SocialOverview = {
  friends: SocialPlayer[];
  following: SocialPlayer[];
  incomingRequests: SocialPlayer[];
  outgoingRequests: SocialPlayer[];
  recentOpponents: RecentOpponent[];
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!ACCOUNT_API) throw new Error('The QQURZ account server is not connected.');
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = accountToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${ACCOUNT_API}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Social server returned ${response.status}.`);
  return payload;
}

export function loadSocialOverview(): Promise<SocialOverview> {
  return requestJson('/social/overview');
}

export async function searchPlayers(query: string): Promise<SocialPlayer[]> {
  return (await requestJson<{ players: SocialPlayer[] }>(`/social/search?q=${encodeURIComponent(query.trim())}`)).players;
}

export async function lookupPlayers(accountIds: string[]): Promise<SocialPlayer[]> {
  if (!accountIds.length) return [];
  return (await requestJson<{ players: SocialPlayer[] }>('/social/lookup', {
    method: 'POST',
    body: JSON.stringify({ accountIds }),
  })).players;
}

export async function setPlayerFollow(accountId: string, follow: boolean): Promise<SocialPlayer | null> {
  return (await requestJson<{ player: SocialPlayer | null }>('/social/follow', {
    method: 'POST',
    body: JSON.stringify({ accountId, follow }),
  })).player;
}

export async function requestFriend(accountId: string): Promise<SocialPlayer | null> {
  return (await requestJson<{ player: SocialPlayer | null }>('/social/friend-request', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  })).player;
}

export async function respondFriendRequest(accountId: string, action: 'accept' | 'decline'): Promise<SocialPlayer | null> {
  return (await requestJson<{ player: SocialPlayer | null }>('/social/friend-request/respond', {
    method: 'POST',
    body: JSON.stringify({ accountId, action }),
  })).player;
}

export async function removeFriend(accountId: string): Promise<void> {
  await requestJson('/social/friend/remove', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}
