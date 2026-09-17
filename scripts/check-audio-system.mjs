import { readFile } from 'node:fs/promises';

const sound = await readFile('src/ui/sound.ts', 'utf8');
const localController = await readFile('src/game/useLocalGameController.ts', 'utf8');
const staging = await readFile('scripts/fetch-chess-audio.mjs', 'utf8');
const sources = await readFile('public/sounds/chess/SOURCES.md', 'utf8');

const fail = message => {
  console.error(`Audio architecture check failed: ${message}`);
  process.exitCode = 1;
};

for (const forbidden of ['createOscillator', 'OscillatorNode', 'createBufferSource', 'createBiquadFilter']) {
  if (sound.includes(forbidden)) fail(`src/ui/sound.ts must not synthesize game effects (${forbidden}).`);
}

for (const cue of ["'move'", "'capture'", "'check'", "'castle'", "'game-start'", "'game-end'"]) {
  if (!sound.includes(cue)) fail(`missing required physical-chess cue ${cue}.`);
}

if (!sound.includes('chessSoundForSan')) fail('SAN must map to one move/capture/check/castle cue.');
if (!sound.includes('feedbackEnabled') || !sound.includes('setFeedbackEnabled')) fail('master sound/haptic mute is required.');
if (!sound.includes("typeof navigator.vibrate === 'function'")) fail('haptics must feature-detect navigator.vibrate().');
if (!sound.includes('options.haptic')) fail('haptics must be opt-in per event, not automatic for remote/background audio.');
if (!localController.includes('chessSoundForSan(san)')) fail('shared local controller must classify SAN before playing move audio.');

for (const asset of ['move.mp3', 'capture.wav', 'check.mp3', 'game-start.mp3', 'game-end.wav']) {
  if (!staging.includes(asset)) fail(`recorded asset ${asset} is not staged for production.`);
}
if (!sources.includes('CC0')) fail('recorded audio provenance/license documentation is required.');

if (!process.exitCode) console.log('QQURZ audio OK: recorded physical chess cues only, master mute, tasteful opt-in haptics.');
