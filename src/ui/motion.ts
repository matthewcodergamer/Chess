import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function currentReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(currentReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
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
