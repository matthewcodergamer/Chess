export type ChessExperience = 'new' | 'basics' | 'experienced' | 'tournament';
export type BoardAppearance = 'walnut' | 'tournament' | 'slate';

export type OnboardingRecord = {
  version: 1;
  completedAt: number;
  experience: ChessExperience;
  boardAppearance: BoardAppearance;
  soundEnabled: boolean;
  accountCreated: boolean;
};

const ONBOARDING_KEY = 'qqurz:onboarding-v1';
const BOARD_APPEARANCE_KEY = 'qqurz:board-appearance';

const EXPERIENCES = new Set<ChessExperience>(['new', 'basics', 'experienced', 'tournament']);
const BOARD_APPEARANCES = new Set<BoardAppearance>(['walnut', 'tournament', 'slate']);

function isExperience(value: unknown): value is ChessExperience {
  return typeof value === 'string' && EXPERIENCES.has(value as ChessExperience);
}

function isBoardAppearance(value: unknown): value is BoardAppearance {
  return typeof value === 'string' && BOARD_APPEARANCES.has(value as BoardAppearance);
}

export function loadOnboardingRecord(): OnboardingRecord | null {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OnboardingRecord>;
    if (value.version !== 1 || !isExperience(value.experience) || !isBoardAppearance(value.boardAppearance)) return null;
    const completedAt = typeof value.completedAt === 'number' && Number.isFinite(value.completedAt) ? value.completedAt : Date.now();
    return {
      version: 1,
      completedAt,
      experience: value.experience,
      boardAppearance: value.boardAppearance,
      soundEnabled: value.soundEnabled !== false,
      accountCreated: value.accountCreated === true,
    };
  } catch {
    return null;
  }
}

export function hasCompletedOnboarding(): boolean {
  return Boolean(loadOnboardingRecord());
}

export function saveOnboardingRecord(record: Omit<OnboardingRecord, 'version' | 'completedAt'>): OnboardingRecord {
  const value: OnboardingRecord = { version: 1, completedAt: Date.now(), ...record };
  try { window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(value)); } catch { /* optional local persistence */ }
  saveBoardAppearance(record.boardAppearance);
  return value;
}

export function loadBoardAppearance(): BoardAppearance {
  try {
    const saved = window.localStorage.getItem(BOARD_APPEARANCE_KEY);
    if (isBoardAppearance(saved)) return saved;
  } catch { /* optional local persistence */ }
  return loadOnboardingRecord()?.boardAppearance ?? 'walnut';
}

export function saveBoardAppearance(value: BoardAppearance): void {
  try { window.localStorage.setItem(BOARD_APPEARANCE_KEY, value); } catch { /* optional local persistence */ }
}

export function boardAppearanceLabel(value: BoardAppearance): string {
  if (value === 'tournament') return 'Tournament green';
  if (value === 'slate') return 'Slate';
  return 'Walnut';
}

/** Experience only changes practice/education defaults. It is never sent to matchmaking. */
export function defaultAiDifficultyForExperience(): 'easy' | 'hard' | 'crazy' {
  const experience = loadOnboardingRecord()?.experience;
  if (experience === 'tournament') return 'crazy';
  if (experience === 'experienced') return 'hard';
  return 'easy';
}
