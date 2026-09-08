export type ChessSound = 'move' | 'capture' | 'slap' | 'coin' | 'start' | 'win' | 'error';

const SOUND_KEY = 'qqurz:sound-enabled';
// CC0 real recorded click by qubodup/OpenGameArt. This is deliberately a
// physical recorded impact, not an oscillator pretending to be a clock.
const CLOCK_PRESS_SAMPLE = 'https://opengameart.org/sites/default/files/click.wav';
let context: AudioContext | null = null;
let movePresetIndex = Math.floor(Math.random() * 30);
let clockSample: HTMLAudioElement | null = null;

const MOVE_PRESETS = [
  [.030, 720, 168, .032, .92], [.036, 810, 174, .039, .84], [.026, 660, 158, .030, .96], [.043, 900, 184, .047, .78], [.033, 760, 162, .036, .88],
  [.049, 850, 192, .052, .76], [.028, 690, 154, .034, .95], [.040, 940, 181, .043, .82], [.035, 790, 170, .041, .90], [.052, 880, 198, .055, .73],
  [.031, 735, 165, .035, .93], [.046, 830, 188, .049, .79], [.024, 640, 151, .029, .98], [.038, 915, 178, .044, .83], [.034, 775, 172, .038, .89],
  [.050, 860, 195, .053, .75], [.029, 705, 160, .033, .94], [.042, 955, 186, .046, .80], [.037, 800, 176, .040, .86], [.054, 895, 201, .057, .72],
  [.032, 745, 164, .037, .91], [.045, 825, 190, .048, .77], [.025, 655, 156, .031, .97], [.039, 925, 180, .045, .81], [.036, 785, 169, .039, .87],
  [.051, 870, 197, .054, .74], [.027, 680, 153, .032, .96], [.041, 945, 183, .044, .82], [.034, 770, 167, .037, .90], [.048, 840, 193, .051, .78],
] as const;

function getAudioContext(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!context || context.state === 'closed') context = new AudioCtx();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch { return null; }
}

function getClockSample(): HTMLAudioElement | null {
  try {
    if (!clockSample) {
      clockSample = new Audio(CLOCK_PRESS_SAMPLE);
      clockSample.preload = 'auto';
      clockSample.volume = .52;
      clockSample.playbackRate = .88;
      clockSample.load();
    }
    return clockSample;
  } catch { return null; }
}

export function soundEnabled(): boolean {
  try { return window.localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setSoundEnabled(value: boolean): void {
  try { window.localStorage.setItem(SOUND_KEY, value ? 'on' : 'off'); } catch { /* optional */ }
  if (value) getClockSample();
}

function haptic(ms: number): void {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

function tone(ctx: AudioContext, frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0, endFrequency?: number): void {
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (endFrequency && endFrequency > 0) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + .0035);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + .025);
}

function noise(ctx: AudioContext, duration: number, volume: number, cutoff = 1300, delay = 0, highpass = 55, attack = .0015): void {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const t = i / length;
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.65);
  }
  const source = ctx.createBufferSource();
  const low = ctx.createBiquadFilter();
  const high = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  low.type = 'lowpass'; low.frequency.value = cutoff; low.Q.value = .55;
  high.type = 'highpass'; high.frequency.value = highpass; high.Q.value = .4;
  const start = ctx.currentTime + delay;
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + attack);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  source.buffer = buffer;
  source.connect(high).connect(low).connect(gain).connect(ctx.destination);
  source.start(start);
}

function bandImpact(ctx: AudioContext, duration: number, volume: number, center: number, q: number, delay = 0): void {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = 'bandpass'; filter.frequency.value = center; filter.Q.value = q;
  const start = ctx.currentTime + delay;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
}

function nextMovePreset() {
  movePresetIndex = (movePresetIndex + 11) % MOVE_PRESETS.length;
  return MOVE_PRESETS[movePresetIndex];
}

function playPieceMove(ctx: AudioContext, capture: boolean): void {
  const [scrapeDuration, cutoff, bodyFrequency, settleDelay, level] = nextMovePreset();
  const gain = capture ? 1.10 : 1;
  noise(ctx, scrapeDuration, .017 * level, cutoff, 0, 85);
  tone(ctx, bodyFrequency, .044, .011 * level, 'triangle', .004, bodyFrequency * .82);
  noise(ctx, capture ? .046 : .031, .036 * level * gain, cutoff + (capture ? 520 : 330), settleDelay, 110);
  tone(ctx, bodyFrequency * (capture ? .66 : .73), capture ? .072 : .052, .023 * level * gain, 'sine', settleDelay + .003, bodyFrequency * .48);
  if (capture) { noise(ctx, .064, .026 * level, 1020, settleDelay + .014, 70); haptic(15); }
}

function fallbackClockSlap(ctx: AudioContext): void {
  // Offline-only fallback: intentionally soft and non-musical.
  bandImpact(ctx, .017, .065, 760, .8, 0);
  noise(ctx, .021, .026, 2100, .002, 260, .001);
  bandImpact(ctx, .052, .026, 150, 1.1, .006);
}

function playRecordedClockSlap(): void {
  const ctx = getAudioContext();
  const prototype = getClockSample();
  if (!prototype) {
    if (ctx) fallbackClockSlap(ctx);
    haptic(20);
    return;
  }
  try {
    const sample = prototype.cloneNode(true) as HTMLAudioElement;
    sample.volume = .52;
    sample.playbackRate = .88 + (Math.random() - .5) * .035;
    const played = sample.play();
    if (played) void played.catch(() => { if (ctx) fallbackClockSlap(ctx); });
  } catch {
    if (ctx) fallbackClockSlap(ctx);
  }
  haptic(20);
}

function playCoin(ctx: AudioContext): void {
  const strike = (delay: number, level: number, pitch = 1) => {
    bandImpact(ctx, .020, .052 * level, 4100 * pitch, 2.1, delay);
    tone(ctx, 3150 * pitch, .070, .024 * level, 'sine', delay, 2450 * pitch);
    tone(ctx, 5150 * pitch, .042, .011 * level, 'sine', delay + .003, 4300 * pitch);
  };
  strike(0, 1, 1); strike(.09, .55, .93); strike(.155, .31, 1.07); strike(.205, .17, .97); haptic(10);
}

export function playChessSound(kind: ChessSound): void {
  if (!soundEnabled()) return;
  if (kind === 'slap') { playRecordedClockSlap(); return; }
  const ctx = getAudioContext();
  if (!ctx) return;
  switch (kind) {
    case 'move': playPieceMove(ctx, false); break;
    case 'capture': playPieceMove(ctx, true); break;
    case 'coin': playCoin(ctx); break;
    case 'start': tone(ctx, 392, .085, .018, 'sine', 0, 430); tone(ctx, 587, .105, .022, 'sine', .065, 630); break;
    case 'win': tone(ctx, 523.25, .15, .026, 'sine'); tone(ctx, 659.25, .17, .026, 'sine', .08); tone(ctx, 783.99, .24, .030, 'sine', .16); break;
    case 'error': tone(ctx, 155, .10, .020, 'square', 0, 132); tone(ctx, 120, .12, .016, 'square', .065, 104); break;
    case 'slap': break;
  }
}
