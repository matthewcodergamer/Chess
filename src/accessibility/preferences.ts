import { useCallback, useEffect, useState } from 'react';

export type FontScale = 'default' | 'large' | 'extra';
export type BoardCoordinates = 'inside' | 'edges' | 'off';

export type AccessibilityPreferences = {
  fontScale: FontScale;
  highContrast: boolean;
  reducedMotion: boolean;
  boardCoordinates: BoardCoordinates;
};

const STORAGE_KEY = 'qqurz:accessibility-v1';
const LEGACY_FONT_SCALE_KEY = 'qqurz:font-scale';
const CHANGE_EVENT = 'qqurz:accessibility-changed';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const DEFAULTS: AccessibilityPreferences = {
  fontScale: 'default',
  highContrast: false,
  reducedMotion: false,
  boardCoordinates: 'inside',
};

function validFontScale(value: unknown): value is FontScale {
  return value === 'default' || value === 'large' || value === 'extra';
}

function validCoordinates(value: unknown): value is BoardCoordinates {
  return value === 'inside' || value === 'edges' || value === 'off';
}

function deviceReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

export function loadAccessibilityPreferences(): AccessibilityPreferences {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<AccessibilityPreferences>;
      return {
        fontScale: validFontScale(value.fontScale) ? value.fontScale : DEFAULTS.fontScale,
        highContrast: value.highContrast === true,
        reducedMotion: value.reducedMotion === true,
        boardCoordinates: validCoordinates(value.boardCoordinates) ? value.boardCoordinates : DEFAULTS.boardCoordinates,
      };
    }
    const legacyScale = window.localStorage.getItem(LEGACY_FONT_SCALE_KEY);
    return { ...DEFAULTS, fontScale: validFontScale(legacyScale) ? legacyScale : DEFAULTS.fontScale };
  } catch {
    return DEFAULTS;
  }
}

export function applyAccessibilityPreferences(preferences: AccessibilityPreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.fontScale = preferences.fontScale;
  root.dataset.contrast = preferences.highContrast ? 'high' : 'default';
  root.dataset.reducedMotion = preferences.reducedMotion || deviceReducedMotion() ? 'true' : 'false';
  root.dataset.boardCoordinates = preferences.boardCoordinates;
}

export function saveAccessibilityPreferences(preferences: AccessibilityPreferences): AccessibilityPreferences {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      window.localStorage.setItem(LEGACY_FONT_SCALE_KEY, preferences.fontScale);
    } catch { /* optional local persistence */ }
  }
  applyAccessibilityPreferences(preferences);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<AccessibilityPreferences>(CHANGE_EVENT, { detail: preferences }));
  return preferences;
}

export function updateAccessibilityPreferences(patch: Partial<AccessibilityPreferences>): AccessibilityPreferences {
  return saveAccessibilityPreferences({ ...loadAccessibilityPreferences(), ...patch });
}

export function subscribeAccessibilityPreferences(listener: (preferences: AccessibilityPreferences) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onChange = (event: Event) => {
    const next = (event as CustomEvent<AccessibilityPreferences>).detail;
    listener(next ?? loadAccessibilityPreferences());
  };
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === STORAGE_KEY || event.key === LEGACY_FONT_SCALE_KEY) listener(loadAccessibilityPreferences());
  };
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
  const onDeviceMotion = () => {
    const preferences = loadAccessibilityPreferences();
    applyAccessibilityPreferences(preferences);
    listener(preferences);
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  media?.addEventListener?.('change', onDeviceMotion);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    media?.removeEventListener?.('change', onDeviceMotion);
  };
}

export function useAccessibilityPreferences(): readonly [AccessibilityPreferences, (patch: Partial<AccessibilityPreferences>) => void] {
  const [preferences, setPreferences] = useState(loadAccessibilityPreferences);
  useEffect(() => {
    applyAccessibilityPreferences(preferences);
    return subscribeAccessibilityPreferences(setPreferences);
  }, []);
  const update = useCallback((patch: Partial<AccessibilityPreferences>) => {
    setPreferences(updateAccessibilityPreferences(patch));
  }, []);
  return [preferences, update] as const;
}

export function boardCoordinateConfig(mode: BoardCoordinates): { coordinates: boolean; coordinatesOnSquares: boolean } {
  return {
    coordinates: mode !== 'off',
    coordinatesOnSquares: mode === 'inside',
  };
}
