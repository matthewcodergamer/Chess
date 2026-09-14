import fs from 'node:fs';
import path from 'node:path';

const root = fs.existsSync('server/src') ? '.' : '..';
const modules = path.join(root, 'server/src/modules');
const required = ['auth','game','realtime','matchmaking','tournament','rating','payments','moderation','notifications','admin'];

for (const name of required) {
  if (!fs.existsSync(path.join(modules, name, 'index.ts'))) throw new Error(`Missing backend module: ${name}`);
  if (fs.existsSync(path.join(modules, name, 'package.json'))) throw new Error(`Backend module ${name} must not become a separate package yet.`);
  if (fs.existsSync(path.join(modules, name, 'wrangler.jsonc'))) throw new Error(`Backend module ${name} must not become a separate Worker yet.`);
}

const gateway = fs.readFileSync(path.join(root, 'server/src/gateway.ts'), 'utf8');
if (!gateway.includes("./modules/realtime")) throw new Error('gateway.ts must compose through modules/realtime.');
for (const implementation of ['./accounts','./matchmaker','./tournaments','./paymentApi','./fairPlay','./notifications','./social','./data/']) {
  if (gateway.includes(implementation)) throw new Error(`gateway.ts bypasses a module facade: ${implementation}`);
}

const realtime = fs.readFileSync(path.join(modules, 'realtime/index.ts'), 'utf8');
for (const facade of ['../admin','../moderation','../notifications','../auth','../payments','../matchmaking','../tournament','../game']) {
  if (!realtime.includes(facade)) throw new Error(`Realtime gateway is missing ${facade}.`);
}

const contracts = fs.readFileSync(path.join(modules, 'contracts.ts'), 'utf8');
for (const service of ['auth','game','realtime-gateway','matchmaking','tournament-engine','rating','payments-ledger','moderation','notifications','admin']) {
  if (!contracts.includes(`'${service}'`)) throw new Error(`Missing service contract: ${service}`);
}

console.log('QQURZ backend modules OK: ten logical services, one Worker, gateway-only composition.');
