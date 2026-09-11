import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function patch(relativePath, replacements) {
  const file = path.join(root, relativePath);
  let source = fs.readFileSync(file, 'utf8');
  for (const [before, after, label] of replacements) {
    if (!source.includes(before)) throw new Error(`${relativePath}: missing fix anchor ${label}`);
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source);
}

patch('server/src/accounts.ts', [
  [
    "  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);",
    "  const saltBuffer = Uint8Array.from(salt).buffer;\n  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations }, key, 256);",
    'PBKDF2 BufferSource',
  ],
  [
    "    await this.ctx.storage.put(`${kind}:${hash}`, { accountId: account.id, expiresAt: Date.now() + ttlMs } satisfies TokenRecord, { expirationTtl: Math.ceil(ttlMs / 1000) });",
    "    await this.ctx.storage.put(`${kind}:${hash}`, { accountId: account.id, expiresAt: Date.now() + ttlMs } satisfies TokenRecord);",
    'Durable Object token expiry option',
  ],
]);

patch('server/src/index.ts', [
  [
    "    if (room.players?.white && !('accountId' in room.players.white)) room.players.white.accountId = null;\n    if (room.players?.black && !('accountId' in room.players.black)) room.players.black.accountId = null;",
    "    if (room.players?.white) room.players.white.accountId = (room.players.white as PlayerSeat & { accountId?: string | null }).accountId ?? null;\n    if (room.players?.black) room.players.black.accountId = (room.players.black as PlayerSeat & { accountId?: string | null }).accountId ?? null;",
    'stored player account migration typing',
  ],
]);

console.log('QQURZ account integration TypeScript compatibility fixes applied.');
