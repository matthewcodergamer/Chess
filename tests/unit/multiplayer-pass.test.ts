import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('public matchmaking uses one atomic room allocation', () => {
  const matchmaker = readFileSync('server/src/matchmaker.ts', 'utf8');
  const room = readFileSync('server/src/index.ts', 'utf8');
  assert.match(matchmaker, /room\.internal\/match/);
  assert.match(room, /url\.pathname === '\/match'/);
});

test('public online arena has no visible physical clock or slap UI', () => {
  const arena = readFileSync('src/multiplayer/OnlineArena.tsx', 'utf8');
  const physicalClock = readFileSync('src/ui/PhysicalChessClock.tsx', 'utf8');
  assert.match(physicalClock, /return\s+null/);
  assert.doesNotMatch(arena, /clock-slap-inline/);
  assert.doesNotMatch(arena, /press your clock/i);
});

test('public frontend source contains no 20 percent fee string', () => {
  const arena = readFileSync('src/multiplayer/OnlineArena.tsx', 'utf8');
  const launch = readFileSync('src/styles/launch-fixes.css', 'utf8');
  assert.doesNotMatch(`${arena}\n${launch}`, /20\s*%/);
});
