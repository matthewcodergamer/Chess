export type TimeControlPresetId = '3+2' | '5+0' | '10+5';
export type TournamentTimeTemplateId = 'club-blitz' | 'open-rapid' | 'championship';
export type Chess960RatingClass = 'bullet' | 'blitz' | 'rapid';

export type TimeControl = {
  id: string;
  label: string;
  baseMs: number;
  incrementMs: number;
  custom: boolean;
};

export type TimeControlRequest = {
  baseMs?: number;
  incrementMs?: number;
  id?: string;
};

export type TournamentTimeTemplate = {
  id: TournamentTimeTemplateId;
  label: string;
  defaultControl: TimeControlPresetId;
  allowedControls: readonly TimeControlPresetId[];
};

export const TIME_CONTROL_LIMITS = {
  minBaseMs: 15_000,
  maxBaseMs: 180 * 60_000,
  maxIncrementMs: 60_000,
} as const;

export const TIME_CONTROL_PRESETS: Record<TimeControlPresetId, TimeControl> = {
  '3+2': { id: '3+2', label: '3+2', baseMs: 3 * 60_000, incrementMs: 2_000, custom: false },
  '5+0': { id: '5+0', label: '5+0', baseMs: 5 * 60_000, incrementMs: 0, custom: false },
  '10+5': { id: '10+5', label: '10+5', baseMs: 10 * 60_000, incrementMs: 5_000, custom: false },
};

export const TOURNAMENT_TIME_TEMPLATES: Record<TournamentTimeTemplateId, TournamentTimeTemplate> = {
  'club-blitz': { id: 'club-blitz', label: 'Club Blitz', defaultControl: '5+0', allowedControls: ['3+2', '5+0'] },
  'open-rapid': { id: 'open-rapid', label: 'Open Rapid', defaultControl: '10+5', allowedControls: ['5+0', '10+5'] },
  championship: { id: 'championship', label: 'Championship', defaultControl: '10+5', allowedControls: ['10+5'] },
};

export const CHESS960_RATING_CLASSES: readonly Chess960RatingClass[] = ['rapid', 'blitz', 'bullet'] as const;

function finite(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function timeControlFromPreset(id: TimeControlPresetId): TimeControl {
  return { ...TIME_CONTROL_PRESETS[id] };
}

export function createCustomTimeControl(baseMinutes: number, incrementSeconds: number): TimeControl {
  const baseMs = Math.round(Math.max(TIME_CONTROL_LIMITS.minBaseMs, Math.min(TIME_CONTROL_LIMITS.maxBaseMs, finite(baseMinutes, 10) * 60_000)));
  const incrementMs = Math.round(Math.max(0, Math.min(TIME_CONTROL_LIMITS.maxIncrementMs, finite(incrementSeconds, 0) * 1_000)));
  const baseLabel = Number.isInteger(baseMs / 60_000) ? String(baseMs / 60_000) : (baseMs / 60_000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const incrementLabel = Number.isInteger(incrementMs / 1_000) ? String(incrementMs / 1_000) : (incrementMs / 1_000).toFixed(1).replace(/\.0$/, '');
  return { id: `custom-${baseMs}-${incrementMs}`, label: `${baseLabel}+${incrementLabel}`, baseMs, incrementMs, custom: true };
}

export function normalizeTimeControl(request?: TimeControlRequest | string | null, fallback: TimeControlPresetId = '10+5'): TimeControl {
  if (typeof request === 'string' && request in TIME_CONTROL_PRESETS) return timeControlFromPreset(request as TimeControlPresetId);
  if (request && typeof request === 'object') {
    if (request.id && request.id in TIME_CONTROL_PRESETS) return timeControlFromPreset(request.id as TimeControlPresetId);
    const baseMs = Math.round(Math.max(TIME_CONTROL_LIMITS.minBaseMs, Math.min(TIME_CONTROL_LIMITS.maxBaseMs, finite(request.baseMs, TIME_CONTROL_PRESETS[fallback].baseMs))));
    const incrementMs = Math.round(Math.max(0, Math.min(TIME_CONTROL_LIMITS.maxIncrementMs, finite(request.incrementMs, TIME_CONTROL_PRESETS[fallback].incrementMs))));
    for (const preset of Object.values(TIME_CONTROL_PRESETS)) {
      if (preset.baseMs === baseMs && preset.incrementMs === incrementMs) return { ...preset };
    }
    return createCustomTimeControl(baseMs / 60_000, incrementMs / 1_000);
  }
  return timeControlFromPreset(fallback);
}

export function tournamentTimeTemplateFor(seats: number, entryCents: number): TournamentTimeTemplate {
  if (seats >= 4096 || entryCents >= 50_000) return TOURNAMENT_TIME_TEMPLATES.championship;
  if (seats >= 512 || entryCents >= 10_000) return TOURNAMENT_TIME_TEMPLATES['open-rapid'];
  return TOURNAMENT_TIME_TEMPLATES['club-blitz'];
}

export function isTournamentControlAllowed(templateId: TournamentTimeTemplateId, control: TimeControl): boolean {
  const template = TOURNAMENT_TIME_TEMPLATES[templateId];
  return template.allowedControls.some(id => {
    const preset = TIME_CONTROL_PRESETS[id];
    return preset.baseMs === control.baseMs && preset.incrementMs === control.incrementMs;
  });
}

/**
 * QQURZ uses the common estimated-game-duration convention: base time plus
 * forty increments. Under three minutes is Bullet, under eight is Blitz,
 * and eight minutes or more is Rapid. The current 3+2 and 5+0 presets are
 * therefore Blitz, while 10+5 is Rapid; very fast custom controls are Bullet.
 */
export function ratingClassForTimeControl(baseMs: number, incrementMs: number): Chess960RatingClass {
  const estimatedGameMs = Math.max(0, finite(baseMs, 0)) + Math.max(0, finite(incrementMs, 0)) * 40;
  if (estimatedGameMs < 3 * 60_000) return 'bullet';
  if (estimatedGameMs < 8 * 60_000) return 'blitz';
  return 'rapid';
}

export function ratingClassLabel(value: Chess960RatingClass): string {
  if (value === 'bullet') return 'Bullet';
  if (value === 'blitz') return 'Blitz';
  return 'Rapid';
}

export function timeControlLabel(baseMs: number, incrementMs: number): string {
  return createCustomTimeControl(baseMs / 60_000, incrementMs / 1_000).label;
}
