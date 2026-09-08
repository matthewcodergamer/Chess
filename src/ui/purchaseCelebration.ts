const COLORS = ['#69DAB0', '#FFD76A', '#F7F1E7', '#FF8BA7', '#8DB8FF'];

function playPurchaseSound(): void {
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    gain.connect(ctx.destination);

    const chime = (frequency: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const localGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, now + start);
      localGain.gain.setValueAtTime(0.0001, now + start);
      localGain.gain.exponentialRampToValueAtTime(0.13, now + start + 0.012);
      localGain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(localGain);
      localGain.connect(gain);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.02);
    };

    chime(523.25, 0, 0.24);
    chime(783.99, 0.10, 0.30);

    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.18), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = ctx.createBufferSource();
    const poof = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    poof.gain.setValueAtTime(0.055, now);
    poof.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(poof);
    poof.connect(ctx.destination);
    source.start(now);

    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    // Audio is decorative. Browsers can block it without affecting the purchase flow.
  }
}

function burstConfetti(origin?: HTMLElement | null): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = origin?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight * 0.42;
  const layer = document.createElement('div');
  layer.className = 'purchase-celebration';
  layer.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < 38; i += 1) {
    const particle = document.createElement('i');
    particle.className = 'purchase-confetti';
    particle.style.setProperty('--x', `${x}px`);
    particle.style.setProperty('--y', `${y}px`);
    particle.style.setProperty('--tx', `${(Math.random() - 0.5) * Math.min(480, window.innerWidth * 0.88)}px`);
    particle.style.setProperty('--ty', `${90 + Math.random() * 360}px`);
    particle.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 1100)}deg`);
    particle.style.setProperty('--delay', `${Math.random() * 85}ms`);
    particle.style.setProperty('--size', `${5 + Math.random() * 8}px`);
    particle.style.setProperty('--confetti', COLORS[i % COLORS.length]);
    if (i % 4 === 0) particle.classList.add('round');
    layer.appendChild(particle);
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 1450);
}

export function celebratePurchase(origin?: HTMLElement | null): void {
  playPurchaseSound();
  burstConfetti(origin);
}
