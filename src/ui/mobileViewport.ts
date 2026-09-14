let installed = false;

function focusedTextControl(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return active;
  if (active instanceof HTMLElement && active.isContentEditable) return active;
  return null;
}

function keepFocusedControlVisible(): void {
  const control = focusedTextControl();
  if (!control) return;

  const settle = () => {
    if (document.activeElement !== control) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const header = document.querySelector<HTMLElement>('.chess-topbar');
    const headerRect = header?.getBoundingClientRect();
    const headerBottom = headerRect && headerRect.bottom > viewportTop && headerRect.top < viewportBottom
      ? headerRect.bottom
      : viewportTop;
    const topGuard = Math.max(viewportTop, headerBottom) + 16;
    const bottomGuard = viewportBottom - 24;
    const rect = control.getBoundingClientRect();
    if (rect.top >= topGuard && rect.bottom <= bottomGuard) return;

    // Numeric scrollTo is intentionally used instead of smooth scrollIntoView.
    // Safari can inherit `scroll-behavior: smooth`, which leaves the keyboard
    // viewport in an intermediate position while it is animating. The focused
    // field needs to become reachable immediately.
    const available = Math.max(control.offsetHeight, bottomGuard - topGuard);
    const targetViewportTop = topGuard + Math.max(0, (available - rect.height) / 2);
    const targetScrollY = Math.max(0, window.scrollY + rect.top - targetViewportTop);
    window.scrollTo(0, targetScrollY);
  };

  window.requestAnimationFrame(settle);
  // iOS can update the visual viewport in more than one step while the keyboard
  // animates. Re-check after that transition without forcing continuous work.
  window.setTimeout(settle, 90);
}

/**
 * Keeps the active form control reachable when Safari's address bars or virtual
 * keyboard change the visual viewport. This is installed once for the app shell
 * and intentionally performs no work unless a text/select control has focus.
 */
export function installMobileViewportFocusGuard(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', keepFocusedControlVisible, { passive: true });
  viewport?.addEventListener('scroll', keepFocusedControlVisible, { passive: true });
  window.addEventListener('resize', keepFocusedControlVisible, { passive: true });
  document.addEventListener('focusin', keepFocusedControlVisible, { passive: true });
}
