export type ChessSound = 'move' | 'capture' | 'slap' | 'coin' | 'start' | 'win' | 'error';

const SOUND_KEY = 'qqurz:sound-enabled';
let context: AudioContext | null = null;

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

function tone(ctx: AudioContext, frequency: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0): void {
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function noise(ctx: AudioContext, duration: number, volume: number, cutoff = 1300): void {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
}

export function playChessSound(kind: ChessSound): void {
  if (!soundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  switch (kind) {
    case 'move':
      noise(ctx, 0.055, 0.028, 780);
      tone(ctx, 180, 0.065, 0.022, 'triangle');
      break;
    case 'capture':
      noise(ctx, 0.09, 0.052, 980);
      tone(ctx, 132, 0.085, 0.035, 'triangle');
      tone(ctx, 94, 0.11, 0.025, 'sine', 0.022);
      haptic(18);
      break;
    case 'slap':
      noise(ctx, 0.065, 0.075, 1500);
      tone(ctx, 118, 0.07, 0.045, 'square');
      tone(ctx, 86, 0.09, 0.03, 'triangle', 0.018);
      haptic(28);
      break;
    case 'coin':
      tone(ctx, 740, 0.09, 0.028, 'sine');
      tone(ctx, 980, 0.08, 0.025, 'sine', 0.08);
      tone(ctx, 620, 0.13, 0.022, 'triangle', 0.17);
      break;
    case 'start':
      tone(ctx, 392, 0.1, 0.024, 'sine');
      tone(ctx, 587, 0.13, 0.028, 'sine', 0.08);
      break;
    case 'win':
      tone(ctx, 523.25, 0.17, 0.03, 'sine');
      tone(ctx, 659.25, 0.18, 0.03, 'sine', 0.09);
      tone(ctx, 783.99, 0.28, 0.035, 'sine', 0.18);
      break;
    case 'error':
      tone(ctx, 155, 0.11, 0.025, 'square');
      tone(ctx, 120, 0.13, 0.02, 'square', 0.07);
      break;
  }
}
