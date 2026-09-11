const configuredBase = (import.meta.env.VITE_MULTIPLAYER_API as string | undefined)?.trim().replace(/\/$/, '');
export const ACCOUNT_API = configuredBase ?? '';
export const ACCOUNT_TOKEN_KEY = 'qqurz:account-token';

export type AccountPrivacy = {
  profileVisibility: 'public' | 'players' | 'private';
  showCountry: boolean;
  showHistory: boolean;
  allowChallenges: boolean;
};

export type AccountNotifications = {
  gameInvites: boolean;
  tournamentUpdates: boolean;
  results: boolean;
  productUpdates: boolean;
};

export type AccountSettings = { language: string; timezone: string };
export type Chess960RatingClass = 'rapid' | 'blitz' | 'bullet';
export type Chess960RatingState = {
  rating: number;
  deviation: number;
  volatility: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  provisional: boolean;
  lastRatedAt: number | null;
};
export type Chess960RatingBook = Record<Chess960RatingClass, Chess960RatingState>;

export type AccountGame = {
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
  ratingClass: Chess960RatingClass;
  ratingBefore: number;
  ratingAfter: number;
  ratingDeviationBefore: number;
  ratingDeviationAfter: number;
  chess960RatingBefore: number;
  chess960RatingAfter: number;
  positionId: number | null;
  baseMs: number;
  incrementMs: number;
  moveCount: number;
};

export type TournamentHistoryItem = {
  id: string;
  tournamentId: string;
  name: string;
  registeredAt: number;
  status: 'registered' | 'in_progress' | 'complete';
  placement: number | null;
};

export type AccountTrophy = {
  id: string;
  title: string;
  tournamentId: string | null;
  placement: number | null;
  awardedAt: number;
};

export type Account = {
  id: string;
  email: string;
  emailVerifiedAt: number | null;
  username: string;
  displayName: string;
  countryCode: string;
  avatar: string;
  avatarImage: string | null;
  ratingModel: 'glicko2';
  chess960Ratings: Chess960RatingBook;
  rating: number;
  chess960Rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  createdAt: number;
  updatedAt: number;
  privacy: AccountPrivacy;
  notifications: AccountNotifications;
  settings: AccountSettings;
  blockedPlayerIds: string[];
  gameHistory: AccountGame[];
  tournamentHistory: TournamentHistoryItem[];
  trophies: AccountTrophy[];
  sessionCount: number;
};

export type AccountSession = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  deviceName: string;
  userAgent: string;
  ipPrefix: string;
  current: boolean;
};

export type BlockedPlayer = { id: string; username: string; displayName: string; avatar: string; avatarImage: string | null };

type RequestOptions = RequestInit & { auth?: boolean };

export function accountToken(): string {
  try { return localStorage.getItem(ACCOUNT_TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function saveAccountToken(token: string): void {
  try {
    if (token) localStorage.setItem(ACCOUNT_TOKEN_KEY, token);
    else localStorage.removeItem(ACCOUNT_TOKEN_KEY);
  } catch { /* optional persistence */ }
}

function syncLegacyProfile(account: Account): void {
  try {
    localStorage.setItem('qqurz:profile', JSON.stringify({
      username: account.displayName || account.username,
      avatar: account.avatar,
      createdAt: account.createdAt,
    }));
    window.dispatchEvent(new CustomEvent('qqurz:account-changed', { detail: account }));
  } catch { /* compatibility profile is optional */ }
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!ACCOUNT_API) throw new Error('The QQURZ account server is not connected.');
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  const token = accountToken();
  if (options.auth !== false && token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${ACCOUNT_API}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    if (response.status === 401 && options.auth !== false) saveAccountToken('');
    throw new Error(payload.error || `Account server returned ${response.status}.`);
  }
  return payload;
}

export async function registerAccount(input: { email: string; password: string; username: string; displayName: string; countryCode?: string; avatar?: string; avatarImage?: string | null }): Promise<{ account: Account; verificationSent: boolean }> {
  const payload = await requestJson<{ account: Account; token: string; verificationSent: boolean }>('/account/register', { method: 'POST', auth: false, body: JSON.stringify(input) });
  saveAccountToken(payload.token);
  syncLegacyProfile(payload.account);
  return { account: payload.account, verificationSent: payload.verificationSent };
}

export async function loginAccount(identifier: string, password: string): Promise<Account> {
  const payload = await requestJson<{ account: Account; token: string }>('/account/login', { method: 'POST', auth: false, body: JSON.stringify({ identifier, password }) });
  saveAccountToken(payload.token);
  syncLegacyProfile(payload.account);
  return payload.account;
}

export async function logoutAccount(): Promise<void> {
  try { await requestJson('/account/logout', { method: 'POST' }); } finally { saveAccountToken(''); }
}

export async function loadAccount(): Promise<Account> {
  const payload = await requestJson<{ account: Account }>('/account/me');
  syncLegacyProfile(payload.account);
  return payload.account;
}

export async function updateAccountProfile(input: Partial<Pick<Account, 'username' | 'displayName' | 'countryCode' | 'avatar' | 'avatarImage'>>): Promise<Account> {
  const payload = await requestJson<{ account: Account }>('/account/profile', { method: 'POST', body: JSON.stringify(input) });
  syncLegacyProfile(payload.account);
  return payload.account;
}

export async function changeAccountPassword(currentPassword: string, newPassword: string): Promise<void> {
  await requestJson('/account/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}

export async function updateAccountNotifications(notifications: Partial<AccountNotifications>): Promise<AccountNotifications> {
  return (await requestJson<{ notifications: AccountNotifications }>('/account/notifications', { method: 'POST', body: JSON.stringify(notifications) })).notifications;
}

export async function updateAccountPrivacy(privacy: Partial<AccountPrivacy>): Promise<AccountPrivacy> {
  return (await requestJson<{ privacy: AccountPrivacy }>('/account/privacy', { method: 'POST', body: JSON.stringify(privacy) })).privacy;
}

export async function updateAccountSettings(settings: Partial<AccountSettings>): Promise<AccountSettings> {
  return (await requestJson<{ settings: AccountSettings }>('/account/settings', { method: 'POST', body: JSON.stringify(settings) })).settings;
}

export async function forgotPassword(email: string): Promise<string> {
  return (await requestJson<{ message: string }>('/account/forgot-password', { method: 'POST', auth: false, body: JSON.stringify({ email }) })).message;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await requestJson('/account/reset-password', { method: 'POST', auth: false, body: JSON.stringify({ token, password }) });
  saveAccountToken('');
}

export async function verifyEmail(token: string): Promise<Account> {
  const payload = await requestJson<{ account: Account }>('/account/verify-email', { method: 'POST', auth: false, body: JSON.stringify({ token }) });
  syncLegacyProfile(payload.account);
  return payload.account;
}

export async function resendVerification(): Promise<boolean> {
  return (await requestJson<{ sent?: boolean; alreadyVerified?: boolean }>('/account/resend-verification', { method: 'POST' })).sent === true;
}

export async function listAccountSessions(): Promise<AccountSession[]> {
  return (await requestJson<{ sessions: AccountSession[] }>('/account/sessions')).sessions;
}

export async function revokeAccountSession(sessionId: string): Promise<{ currentRevoked: boolean }> {
  return requestJson<{ currentRevoked: boolean }>('/account/sessions/revoke', { method: 'POST', body: JSON.stringify({ sessionId }) });
}

export async function revokeOtherSessions(): Promise<void> {
  await requestJson('/account/sessions/revoke-others', { method: 'POST' });
}

export async function listBlockedPlayers(): Promise<BlockedPlayer[]> {
  return (await requestJson<{ players: BlockedPlayer[] }>('/account/blocked')).players;
}

export async function blockPlayer(username: string): Promise<void> {
  await requestJson('/account/block', { method: 'POST', body: JSON.stringify({ username }) });
}

export async function unblockPlayer(username: string): Promise<void> {
  await requestJson('/account/unblock', { method: 'POST', body: JSON.stringify({ username }) });
}

export async function deleteAccount(password: string): Promise<void> {
  await requestJson('/account/delete', { method: 'POST', body: JSON.stringify({ password, confirmation: 'DELETE' }) });
  saveAccountToken('');
}

export async function socialProviderStatus(): Promise<{ google: boolean; apple: boolean; ordinaryAuthRequired: boolean }> {
  return requestJson('/account/social-status', { auth: false });
}
