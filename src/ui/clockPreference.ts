const CLOCK_VISIBLE_KEY = 'qqurz:clock-visible';
const PREMIUM_CLOCK_VISIBLE_KEY = 'qqurz:physical-clock-visible';
const CLOCK_EVENT = 'qqurz:clock-visibility-change';

export function clockVisible(): boolean {
  try {
    const premiumValue = window.localStorage.getItem(PREMIUM_CLOCK_VISIBLE_KEY);
    if (premiumValue === 'off' || premiumValue === 'on') return premiumValue !== 'off';
    return window.localStorage.getItem(CLOCK_VISIBLE_KEY) !== 'off';
  } catch { return true; }
}

export function setClockVisible(visible: boolean): void {
  try {
    const value = visible ? 'on' : 'off';
    window.localStorage.setItem(CLOCK_VISIBLE_KEY, value);
    window.localStorage.setItem(PREMIUM_CLOCK_VISIBLE_KEY, value);
  } catch { /* optional */ }
  try { window.dispatchEvent(new CustomEvent(CLOCK_EVENT, { detail: visible })); } catch { /* optional */ }
}

export function subscribeClockVisible(listener: (visible: boolean) => void): () => void {
  const onCustom = (event: Event) => listener(Boolean((event as CustomEvent<boolean>).detail));
  const onStorage = (event: StorageEvent) => {
    if (event.key === CLOCK_VISIBLE_KEY || event.key === PREMIUM_CLOCK_VISIBLE_KEY) listener(clockVisible());
  };
  window.addEventListener(CLOCK_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CLOCK_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
