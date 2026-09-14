import { applyDataCommands, type DataModelEnv } from './registry';
import type { DataCommand } from './model';

const OUTBOX_PREFIX = 'canonical-outbox:v1:';
const MAX_DRAIN = 25;
const MAX_ATTEMPTS_BEFORE_BACKOFF = 8;

type ProjectionEnvelope = {
  id: string;
  commands: DataCommand[];
  createdAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
};

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? 'projection failed')).slice(0, 500);
}

function key(id: string): string {
  return `${OUTBOX_PREFIX}${id}`;
}

export async function queueCanonicalProjection(
  storage: DurableObjectStorage,
  env: DataModelEnv,
  commands: DataCommand[],
  id = crypto.randomUUID(),
): Promise<boolean> {
  if (!commands.length) return true;
  const envelope: ProjectionEnvelope = {
    id,
    commands,
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
  };
  const storageKey = key(id);
  await storage.put(storageKey, envelope);
  try {
    await applyDataCommands(env, commands);
    await storage.delete(storageKey);
    return true;
  } catch (error) {
    envelope.attempts = 1;
    envelope.lastAttemptAt = Date.now();
    envelope.lastError = message(error);
    await storage.put(storageKey, envelope);
    return false;
  }
}

export async function drainCanonicalOutbox(storage: DurableObjectStorage, env: DataModelEnv): Promise<{ delivered: number; pending: number }> {
  const rows = await storage.list<ProjectionEnvelope>({ prefix: OUTBOX_PREFIX, limit: MAX_DRAIN });
  let delivered = 0;
  for (const [storageKey, envelope] of rows) {
    if (!Array.isArray(envelope.commands) || !envelope.commands.length) {
      await storage.delete(storageKey);
      continue;
    }
    const now = Date.now();
    const backoffMs = envelope.attempts < MAX_ATTEMPTS_BEFORE_BACKOFF ? 0 : Math.min(60_000, 1000 * 2 ** Math.min(6, envelope.attempts - MAX_ATTEMPTS_BEFORE_BACKOFF));
    if (envelope.lastAttemptAt && now - envelope.lastAttemptAt < backoffMs) continue;
    try {
      await applyDataCommands(env, envelope.commands);
      await storage.delete(storageKey);
      delivered += 1;
    } catch (error) {
      envelope.attempts += 1;
      envelope.lastAttemptAt = now;
      envelope.lastError = message(error);
      await storage.put(storageKey, envelope);
    }
  }
  const pending = (await storage.list({ prefix: OUTBOX_PREFIX, limit: 1000 })).size;
  return { delivered, pending };
}

export async function canonicalOutboxHealth(storage: DurableObjectStorage): Promise<{ pending: number; oldestMs: number; maxAttempts: number }> {
  const rows = await storage.list<ProjectionEnvelope>({ prefix: OUTBOX_PREFIX, limit: 1000 });
  let oldest = Date.now();
  let maxAttempts = 0;
  for (const envelope of rows.values()) {
    oldest = Math.min(oldest, envelope.createdAt || oldest);
    maxAttempts = Math.max(maxAttempts, envelope.attempts || 0);
  }
  return { pending: rows.size, oldestMs: rows.size ? Math.max(0, Date.now() - oldest) : 0, maxAttempts };
}
