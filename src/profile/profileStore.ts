export type Profile = {
  username: string;
  avatar: string;
  createdAt: number;
};

export const PROFILE_KEY = 'qqurz:profile';
export const AVATARS = ['♟', '♞', '♜', '♝', '♛', '♚', '960', 'Q'] as const;

const FIRST = ['Rapid', 'Quiet', 'Royal', 'Green', 'Park', 'Knight', 'Castle', 'Tempo', 'Sharp', 'Freestyle'];
const SECOND = ['Rook', 'Pawn', 'Bishop', 'Knight', 'Queen', 'Gambit', 'Clock', 'Hustler', 'File', 'Fork'];

export function randomUsername(): string {
  const first = FIRST[Math.floor(Math.random() * FIRST.length)];
  const second = SECOND[Math.floor(Math.random() * SECOND.length)];
  const number = 10 + Math.floor(Math.random() * 990);
  return `${first}${second}${number}`;
}

export function sanitizeUsername(value: string): string {
  return value.replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 24);
}

export function loadProfile(): Profile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Profile>;
    const username = typeof value.username === 'string' ? sanitizeUsername(value.username) : '';
    const avatar = typeof value.avatar === 'string' && value.avatar.trim() ? value.avatar.trim().slice(0, 3) : '';
    if (!username || !avatar) return null;
    const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
    return { username, avatar, createdAt };
  } catch {
    return null;
  }
}

export function saveProfile(username: string, avatar = '♞', createdAt?: number): Profile {
  const clean = sanitizeUsername(username) || randomUsername();
  const profile: Profile = {
    username: clean,
    avatar: avatar.trim() || '♞',
    createdAt: createdAt ?? loadProfile()?.createdAt ?? Date.now(),
  };
  try { window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* optional local persistence */ }
  return profile;
}
