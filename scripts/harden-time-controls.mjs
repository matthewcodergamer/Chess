import fs from 'node:fs';

function replaceOnce(path, from, to, label) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(from)) throw new Error(`Missing hardening anchor: ${label}`);
  fs.writeFileSync(path, source.replace(from, to));
}

replaceOnce(
  'shared/gameSession.ts',
  `    clocks: { ...session.clocks, startedAt: to === 'ACTIVE' ? at : null },`,
  `    clocks: {\n      ...session.clocks,\n      // Reconnecting is not a pause. Preserve the authoritative start point so\n      // reconnects can never manufacture clock time. ACTIVE only starts a new\n      // interval when there is no running interval to preserve.\n      startedAt: to === 'ACTIVE' ? (session.clocks.startedAt ?? at) : to === 'RECONNECTING' ? session.clocks.startedAt : null,\n    },`,
  'reconnect-safe generic transition',
);

replaceOnce(
  'src/multiplayer/OnlineArena.tsx',
  `import { TIME_CONTROL_PRESETS, TOURNAMENT_TIME_TEMPLATES, createCustomTimeControl, timeControlLabel, type TimeControl, type TimeControlPresetId, type TournamentTimeTemplateId } from '../../shared/timeControl';`,
  `import { TIME_CONTROL_PRESETS, TOURNAMENT_TIME_TEMPLATES, normalizeTimeControl, timeControlLabel, type TimeControl, type TimeControlPresetId, type TournamentTimeTemplateId } from '../../shared/timeControl';`,
  'tournament normalize import',
);
replaceOnce(
  'src/multiplayer/OnlineArena.tsx',
  `    const control = selected?.baseMinutes !== undefined\n      ? createCustomTimeControl(selected.baseMinutes, selected.incrementSeconds ?? 0)\n      : { ...TIME_CONTROL_PRESETS[template.defaultControl] };`,
  `    const control = selected?.baseMinutes !== undefined\n      ? normalizeTimeControl({ baseMs: selected.baseMinutes * 60_000, incrementMs: (selected.incrementSeconds ?? 0) * 1_000 }, template.defaultControl)\n      : { ...TIME_CONTROL_PRESETS[template.defaultControl] };`,
  'tournament preset normalization',
);

replaceOnce(
  'server/src/index.ts',
  `const LATENCY_CREDIT_CAP_MS = 75;\nconst LATENCY_CREDIT_FRACTION = .05;`,
  `const LATENCY_CREDIT_CAP_MS = 50;\nconst LATENCY_CREDIT_FRACTION = .03;`,
  'bounded latency constants',
);
replaceOnce(
  'server/src/index.ts',
  `    const settled = this.settleActiveClock(serverReceivedAt, token);`,
  `    // A move does not receive lag credit because the physical clock keeps\n    // running until its authoritative clock press. Credit is applied once, at\n    // that press, preventing repeated move/invalid-message lag farming.\n    const settled = this.settleActiveClock(serverReceivedAt);`,
  'single latency credit point',
);

console.log('Time-control hardening applied: reconnects never pause, tournament presets normalize exactly, and latency credit is bounded to one authoritative clock press per move.');
