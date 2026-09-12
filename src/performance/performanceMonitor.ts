export type QQurzPerformanceSnapshot = {
  startedAt: number;
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  maxInputDelayMs: number;
  maxInteractionDurationMs: number;
  jsHeapUsedBytes: number | null;
  jsHeapLimitBytes: number | null;
  memorySource: 'performance.memory' | 'measureUserAgentSpecificMemory' | 'unavailable';
};

type LayoutShiftEntry = PerformanceEntry & { value?: number; hadRecentInput?: boolean };
type EventTimingEntry = PerformanceEntry & { processingStart?: number; duration?: number };
type MemoryPerformance = Performance & {
  memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
};

declare global {
  interface Window {
    __QQURZ_PERFORMANCE__?: () => Readonly<QQurzPerformanceSnapshot>;
  }
}

const state: QQurzPerformanceSnapshot = {
  startedAt: performance.now(),
  firstContentfulPaintMs: null,
  largestContentfulPaintMs: null,
  cumulativeLayoutShift: 0,
  longTaskCount: 0,
  longTaskTotalMs: 0,
  longTaskMaxMs: 0,
  maxInputDelayMs: 0,
  maxInteractionDurationMs: 0,
  jsHeapUsedBytes: null,
  jsHeapLimitBytes: null,
  memorySource: 'unavailable',
};

function observe(type: string, callback: (entries: PerformanceEntry[]) => void) {
  if (typeof PerformanceObserver !== 'function') return null;
  try {
    const observer = new PerformanceObserver(list => callback(list.getEntries()));
    observer.observe({ type, buffered: true } as PerformanceObserverInit);
    return observer;
  } catch {
    return null;
  }
}

async function sampleMemory() {
  const perf = performance as MemoryPerformance;
  if (perf.memory?.usedJSHeapSize) {
    state.jsHeapUsedBytes = perf.memory.usedJSHeapSize;
    state.jsHeapLimitBytes = perf.memory.jsHeapSizeLimit ?? null;
    state.memorySource = 'performance.memory';
    return;
  }
  if (perf.measureUserAgentSpecificMemory && window.crossOriginIsolated) {
    try {
      const result = await perf.measureUserAgentSpecificMemory();
      state.jsHeapUsedBytes = result.bytes;
      state.jsHeapLimitBytes = null;
      state.memorySource = 'measureUserAgentSpecificMemory';
    } catch {
      state.memorySource = 'unavailable';
    }
  }
}

export function startPerformanceMonitoring(): () => void {
  const observers = [
    observe('paint', entries => {
      const fcp = entries.find(entry => entry.name === 'first-contentful-paint');
      if (fcp) state.firstContentfulPaintMs = Math.round(fcp.startTime);
    }),
    observe('largest-contentful-paint', entries => {
      const latest = entries.at(-1);
      if (latest) state.largestContentfulPaintMs = Math.round(latest.startTime);
    }),
    observe('layout-shift', entries => {
      for (const entry of entries as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput) state.cumulativeLayoutShift += entry.value ?? 0;
      }
    }),
    observe('longtask', entries => {
      for (const entry of entries) {
        state.longTaskCount += 1;
        state.longTaskTotalMs += entry.duration;
        state.longTaskMaxMs = Math.max(state.longTaskMaxMs, entry.duration);
      }
    }),
    observe('event', entries => {
      for (const entry of entries as EventTimingEntry[]) {
        if (entry.processingStart !== undefined) {
          state.maxInputDelayMs = Math.max(state.maxInputDelayMs, entry.processingStart - entry.startTime);
        }
        state.maxInteractionDurationMs = Math.max(state.maxInteractionDurationMs, entry.duration ?? 0);
      }
    }),
  ].filter(Boolean) as PerformanceObserver[];

  window.__QQURZ_PERFORMANCE__ = () => Object.freeze({ ...state });
  const idle = window.requestIdleCallback?.(() => void sampleMemory(), { timeout: 3000 })
    ?? window.setTimeout(() => void sampleMemory(), 1800);
  const onVisibility = () => { if (document.visibilityState === 'hidden') void sampleMemory(); };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    observers.forEach(observer => observer.disconnect());
    if (window.cancelIdleCallback && typeof idle === 'number') window.cancelIdleCallback(idle);
    else window.clearTimeout(idle);
    document.removeEventListener('visibilitychange', onVisibility);
    delete window.__QQURZ_PERFORMANCE__;
  };
}
