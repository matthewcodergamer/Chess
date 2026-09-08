export type ChessSound = 'move' | 'capture' | 'slap' | 'coin' | 'start' | 'win' | 'error';

const SOUND_KEY = 'qqurz:sound-enabled';
let context: AudioContext | null = null;
let movePresetIndex = Math.floor(Math.random() * 30);

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
  } catch {
    return null;
  }
}

export function soundEnabled(): boolean {
  try { return window.localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setSoundEnabled(value: boolean): void {
  try { window.localStorage.setItem(SOUND_KEY, value ? 'on' : 'off'); } catch { /* optional */ }
}

function haptic(ms: number): void {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

function tone(
  ctx: AudioContext,
  frequency: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  delay = 0,
): void {
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + .004);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + .025);
}

function noise(
  ctx: AudioContext,
  duration: number,
  volume: number,
  cutoff = 1300,
  delay = 0,
  highpass = 55,
): void {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const envelope = Math.pow(1 - i / length, 1.9);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }
  const source = ctx.createBufferSource();
  const low = ctx.createBiquadFilter();
  const high = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  low.type = 'lowpass';
  low.frequency.value = cutoff;
  high.type = 'highpass';
  high.frequency.value = highpass;
  const start = ctx.currentTime + delay;
  gain.gain.setValueAtTime(Math.max(.0002, volume), start);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  source.buffer = buffer;
  source.connect(high).connect(low).connect(gain).connect(ctx.destination);
  source.start(start);
}

function nextMovePreset() {
  movePresetIndex = (movePresetIndex + 11) % MOVE_PRESETS.length;
  return MOVE_PRESETS[movePresetIndex];
}

function playPieceMove(ctx: AudioContext, capture: boolean): void {
  const [scrapeDuration, cutoff, bodyFrequency, settleDelay, level] = nextMovePreset();
  const gain = capture ? 1.10 : 1;
  noise(ctx, scrapeDuration, .018 * level, cutoff, 0, 85);
  tone(ctx, bodyFrequency, .044, .012 * level, 'triangle', .004);
  noise(ctx, capture ? .046 : .031, .038 * level * gain, cutoff + (capture ? 520 : 330), settleDelay, 110);
  tone(ctx, bodyFrequency * (capture ? .66 : .73), capture ? .072 : .052, .025 * level * gain, 'sine', settleDelay + .003);
  tone(ctx, bodyFrequency * 1.42, .025, .009 * level, 'triangle', settleDelay + .008);
  if (capture) {
    noise(ctx, .065, .030 * level, 1050, settleDelay + .014, 70);
    tone(ctx, bodyFrequency * .48, .095, .020 * level, 'sine', settleDelay + .014);
    haptic(16);
  }
}

function playClockSlap(ctx: AudioContext): void {
  // Soft physical rocker press. This follows the short contact/body/rebound
  // shape heard in real chess-clock recordings instead of the old hard,
  // bright multi-layer effect. No electronic beep is mixed into a slap.
  noise(ctx, .010, .040, 2450, 0, 420);       // fingertip/plastic contact
  tone(ctx, 138, .052, .018, 'sine', .002);  // hollow ABS case body
  noise(ctx, .023, .026, 1150, .006, 90);    // rocker settling into its stop
  tone(ctx, 91, .065, .010, 'sine', .010);   // low case resonance
  noise(ctx, .008, .015, 2100, .044, 380);   // tiny mechanical rebound
  tone(ctx, 126, .032, .007, 'triangle', .046);
  haptic(12);
}

function playCoin(ctx: AudioContext): void {
  // Short metal-on-wood toss/landing instead of a melodic notification.
  noise(ctx, .010, .036, 7200, 0, 2200);
  tone(ctx, 3150, .085, .014, 'sine', .002);
  tone(ctx, 2240, .105, .011, 'sine', .012);
  noise(ctx, .018, .026, 5600, .105, 1200);
  tone(ctx, 1760, .120, .009, 'triangle', .108);
  haptic(8);
}

export function playChessSound(kind: ChessSound): void {
  if (!soundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  switch (kind) {
    case 'move': playPieceMove(ctx, false); break;
    case 'capture': playPieceMove(ctx, true); break;
    case 'slap': playClockSlap(ctx); break;
    case 'coin': playCoin(ctx); break;
    case 'start':
      tone(ctx, 392, .10, .024, 'sine');
      tone(ctx, 587, .13, .028, 'sine', .08);
      break;
    case 'win':
      tone(ctx, 523.25, .17, .030, 'sine');
      tone(ctx, 659.25, .18, .030, 'sine', .09);
      tone(ctx, 783.99, .28, .035, 'sine', .18);
      break;
    case 'error':
      tone(ctx, 155, .11, .025, 'square');
      tone(ctx, 120, .13, .020, 'square', .07);
      break;
  }
}
