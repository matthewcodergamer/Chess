export type ChessSound = 'move' | 'capture' | 'check' | 'castle' | 'game-start' | 'game-end' | 'clock' | 'coin' | 'error'
  | 'start' | 'win' | 'slap';
export type ChessSoundOptions = { haptic?: boolean; sound?: boolean };

const SOUND_KEY = 'qqurz:sound-enabled';
const HAPTICS_KEY = 'qqurz:haptics-enabled';
const FEEDBACK_KEY = 'qqurz:feedback-enabled';
const AUDIO_BASE = `${import.meta.env.BASE_URL ?? '/'}sounds/chess/`;

const SAMPLE = {
  move: { file: 'move.mp3', volume: .26, rate: 1 },
  capture: { file: 'capture.wav', volume: .31, rate: .96 },
  check: { file: 'check.mp3', volume: .25, rate: 1.02 },
  'game-start': { file: 'game-start.mp3', volume: .25, rate: .98 },
  'game-end': { file: 'game-end.wav', volume: .28, rate: .94 },
  clock: { file: 'clock.mp3', volume: .38, rate: .92 },
  coin: { file: 'coin.mp3', volume: .24, rate: 1 },
} as const;

type RecordedSound = keyof typeof SAMPLE;
const prototypes = new Map<RecordedSound, HTMLAudioElement>();

function normalizedKind(kind: ChessSound): Exclude<ChessSound, 'start' | 'win' | 'slap'> {
  if (kind === 'start') return 'game-start';
  if (kind === 'win') return 'game-end';
  if (kind === 'slap') return 'clock';
  return kind;
}

function sample(kind: RecordedSound): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  try {
    const existing = prototypes.get(kind);
    if (existing) return existing;
    const meta = SAMPLE[kind];
    const audio = new Audio(`${AUDIO_BASE}${meta.file}`);
    audio.preload = 'auto';
    audio.volume = meta.volume;
    audio.playbackRate = meta.rate;
    prototypes.set(kind, audio);
    return audio;
  } catch { return null; }
}

function playRecorded(kind: RecordedSound, delayMs = 0): void {
  const run = () => {
    if (!feedbackEnabled() || !soundEnabled()) return;
    const prototype = sample(kind);
    if (!prototype) return;
    try {
      const audio = prototype.cloneNode(true) as HTMLAudioElement;
      const meta = SAMPLE[kind];
      audio.volume = meta.volume;
      audio.playbackRate = meta.rate;
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback) void playback.catch(() => undefined);
    } catch { /* audio is optional */ }
  };
  if (delayMs > 0) window.setTimeout(run, delayMs);
  else run();
}

function preloadRecordedSounds(): void {
  (Object.keys(SAMPLE) as RecordedSound[]).forEach(kind => sample(kind)?.load());
}

export function feedbackEnabled(): boolean {
  try { return window.localStorage.getItem(FEEDBACK_KEY) !== 'off'; } catch { return true; }
}

export function setFeedbackEnabled(value: boolean): void {
  try { window.localStorage.setItem(FEEDBACK_KEY, value ? 'on' : 'off'); } catch { /* optional */ }
  if (!value && hapticsSupported()) {
    try { navigator.vibrate(0); } catch { /* unsupported */ }
  }
  if (value && soundEnabled()) preloadRecordedSounds();
}

export function soundEnabled(): boolean {
  try { return window.localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setSoundEnabled(value: boolean): void {
  try { window.localStorage.setItem(SOUND_KEY, value ? 'on' : 'off'); } catch { /* optional */ }
  if (value && feedbackEnabled()) preloadRecordedSounds();
}

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function hapticsEnabled(): boolean {
  try { return window.localStorage.getItem(HAPTICS_KEY) !== 'off'; } catch { return true; }
}

export function setHapticsEnabled(value: boolean): void {
  try { window.localStorage.setItem(HAPTICS_KEY, value ? 'on' : 'off'); } catch { /* optional */ }
  if (!value && hapticsSupported()) {
    try { navigator.vibrate(0); } catch { /* unsupported */ }
  }
}

function haptic(pattern: VibratePattern): void {
  if (!feedbackEnabled() || !hapticsEnabled() || !hapticsSupported()) return;
  try { navigator.vibrate(pattern); } catch { /* unsupported */ }
}

function playChessHaptic(kind: Exclude<ChessSound, 'start' | 'win' | 'slap'>): void {
  switch (kind) {
    case 'move': haptic(5); break;
    case 'capture': haptic(9); break;
    case 'check': haptic(8); break;
    case 'castle': haptic([5, 36, 5]); break;
    case 'game-start': haptic(6); break;
    case 'game-end': haptic(11); break;
    case 'clock': haptic(13); break;
    case 'coin': haptic(5); break;
    case 'error': haptic(7); break;
  }
}

/**
 * Converts SAN into one physical-chess sound event. Priority is castle, check,
 * capture, then ordinary placement so one move never produces a noisy stack of
 * overlapping effects.
 */
export function chessSoundForSan(san: string): ChessSound {
  if (/^O-O(?:-O)?/.test(san)) return 'castle';
  if (/[+#]$/.test(san)) return 'check';
  if (san.includes('x')) return 'capture';
  return 'move';
}

/**
 * Plays only recorded/organic source material. Haptics are deliberately opt-in
 * per call so remote opponent and background events do not vibrate the device.
 */
export function playChessSound(kind: ChessSound, options: ChessSoundOptions = {}): void {
  if (!feedbackEnabled()) return;
  const normalized = normalizedKind(kind);
  if (options.haptic) playChessHaptic(normalized);
  if (options.sound === false || !soundEnabled() || normalized === 'error') return;

  if (normalized === 'castle') {
    // King then rook: two quiet recorded board-contact sounds, no success jingle.
    playRecorded('move');
    playRecorded('move', 72);
    return;
  }

  if (normalized === 'move' || normalized === 'capture' || normalized === 'check' || normalized === 'game-start'
    || normalized === 'game-end' || normalized === 'clock' || normalized === 'coin') {
    playRecorded(normalized);
  }
}
