const CLOCK_VISIBLE_KEY = 'qqurz:clock-visible';
const CLOCK_EVENT = 'qqurz:clock-visibility-change';

export function clockVisible(): boolean {
  try { return window.localStorage.getItem(CLOCK_VISIBLE_KEY) !== 'off'; } catch { return true; }
}

export function setClockVisible(visible: boolean): void {
  try { window.localStorage.setItem(CLOCK_VISIBLE_KEY, visible ? 'on' : 'off'); } catch { /* optional */ }
  try { window.dispatchEvent(new CustomEvent(CLOCK_EVENT, { detail: visible })); } catch { /* optional */ }
}

export function subscribeClockVisible(listener: (visible: boolean) => void): () => void {
  const onCustom = (event: Event) => listener(Boolean((event as CustomEvent<boolean>).detail));
  const onStorage = (event: StorageEvent) => { if (event.key === CLOCK_VISIBLE_KEY) listener(clockVisible()); };
  window.addEventListener(CLOCK_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CLOCK_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
