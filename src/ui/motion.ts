import { useEffect, useState } from 'react';
import { loadAccessibilityPreferences, subscribeAccessibilityPreferences } from '../accessibility/preferences';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function systemReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

export function reducedMotionPreferred(): boolean {
  return loadAccessibilityPreferences().reducedMotion || systemReducedMotion();
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reducedMotionPreferred);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
    const update = () => setReduced(loadAccessibilityPreferences().reducedMotion || Boolean(media?.matches));
    update();
    media?.addEventListener?.('change', update);
    const unsubscribe = subscribeAccessibilityPreferences(update);
    return () => {
      media?.removeEventListener?.('change', update);
      unsubscribe();
    };
  }, []);

  return reduced;
}

export function motionTokenMs(token: `--q-motion-${string}`, fallbackMs: number): number {
  if (typeof window === 'undefined') return fallbackMs;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!raw) return fallbackMs;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallbackMs;
  if (raw.endsWith('ms')) return value;
  if (raw.endsWith('s')) return value * 1000;
  return fallbackMs;
}
