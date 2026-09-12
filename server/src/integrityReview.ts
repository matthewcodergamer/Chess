import { DurableObject } from 'cloudflare:workers';

export type IntegrityMoveEvidence = {
  ply: number;
  color: 'white' | 'black';
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  clientSequence: number | null;
  clientSentAt: number | null;
  serverReceivedAt: number;
  serverCommittedAt: number;
  thinkTimeMs: number;
  chargedElapsedMs: number;
  latencyCreditMs: number;
  clientToServerMs: number | null;
  complexity: {
    pieceCount: number;
    pawnCount: number;
    nonPawnPieceCount: number;
    materialImbalance: number;
    inCheck: boolean;
  };
};

export type IntegrityConnectionSignal = {
  accountId: string | null;
  color: 'white' | 'black';
  connectedAt: number;
  deviceSignalHash: string | null;
  networkSignalHash: string | null;
  countryCode: string | null;
  regionCode: string | null;
};

export type IntegrityPlayer = {
  accountId: string | null;
  name: string;
  color: 'white' | 'black';
};

export type IntegrityGameEvidence = {
  schema: 'qqurz-integrity-game-v1';
  gameId: string;
  roomCode: string;
  tournamentId: string | null;
  money: boolean;
  stakeCents: number;
  createdAt: number;
  finalizedAt: number;
  result: string;
  resultKind: string | null;
  winnerAccountId: string | null;
  players: IntegrityPlayer[];
  moves: IntegrityMoveEvidence[];
  connections: IntegrityConnectionSignal[];
};

export type IntegritySignalCode =
  | 'shared_device_signal'
  | 'shared_network_signal'
  | 'repeated_money_opponents'
  | 'repeated_tournament_opponents'
  | 'ultrafast_move_cluster'
  | 'client_timestamp_anomalies';

export type IntegrityTriageSignal = {
  code: IntegritySignalCode;
  weight: number;
  detail: string;
};

export type IntegrityReviewStatus = 'queued' | 'in_review' | 'second_review' | 'cleared' | 'escalated' | 'action_required';

export type IntegrityReviewCase = {
  id: string;
  gameId: string;
  roomCode: string;
  tournamentId: string | null;
  money: boolean;
  priority: 'standard' | 'medium' | 'high';
  status: IntegrityReviewStatus;
  score: number;
  threshold: number;
  signals: IntegrityTriageSignal[];
  createdAt: number;
  updatedAt: number;
  reviewers: string[];
  notes: Array<{ reviewerId: string; note: string; at: number }>;
  disclaimer: string;
};

type GameSummary = Omit<IntegrityGameEvidence, 'moves' | 'connections'> & {
  moveCount: number;
  connectionCount: number;
  retentionClass: 'casual_90d' | 'tournament_365d' | 'money_730d';
  reviewCaseId: string | null;
  triageScore: number;
};

type Relationship = {
  accountA: string;
  accountB: string;
  games: number;
  moneyGames: number;
  tournamentGames: number;
  lastPlayedAt: number;
  gameIds: string[];
};

export type IntegritySettlementDisposition = {
  gameId: string;
  disposition: 'allow' | 'manual_review';
  reviewCaseId: string | null;
  reason: string | null;
};

export type IntegrityRegistryEnv = {
  INTEGRITY_INTERNAL_SECRET?: string;
  INTEGRITY_ADMIN_SECRET?: string;
};

export type IntegrityEnv = IntegrityRegistryEnv & {
  INTEGRITY: DurableObjectNamespace<IntegrityReviewRegistry>;
  INTEGRITY_SIGNAL_CAPTURE?: string;
  INTEGRITY_SIGNAL_SECRET?: string;
};

const GAME_PREFIX = 'integrity:game:v1:';
const CASE_PREFIX = 'integrity:case:v1:';
const REL_PREFIX = 'integrity:relationship:v1:';
const CASE_INDEX = 'integrity:case-index:v1';
const MOVE_CHUNK_SIZE = 64;
const MAX_CASE_INDEX = 5_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function clean(value: unknown, max = 200): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function pairKey(players: IntegrityPlayer[]): string | null {
  const ids = players.map(player => player.accountId).filter((value): value is string => Boolean(value)).sort();
  return ids.length === 2 && ids[0] !== ids[1] ? `${ids[0]}:${ids[1]}` : null;
}

function intersection(valuesA: Array<string | null>, valuesB: Array<string | null>): string[] {
  const a = new Set(valuesA.filter((value): value is string => Boolean(value)));
  return [...new Set(valuesB.filter((value): value is string => Boolean(value)))].filter(value => a.has(value));
}

function timingVariation(values: number[]): number {
  if (values.length < 2) return 1;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return 1;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function triage(evidence: IntegrityGameEvidence, relationship: Relationship | null): { score: number; threshold: number; signals: IntegrityTriageSignal[] } {
  const signals: IntegrityTriageSignal[] = [];
  const byColor = {
    white: evidence.connections.filter(signal => signal.color === 'white'),
    black: evidence.connections.filter(signal => signal.color === 'black'),
  };
  if (intersection(byColor.white.map(value => value.deviceSignalHash), byColor.black.map(value => value.deviceSignalHash)).length) {
    signals.push({ code: 'shared_device_signal', weight: 70, detail: 'Opponents presented the same pseudonymous device/client signal. This is review evidence, not proof of cheating.' });
  }
  if (intersection(byColor.white.map(value => value.networkSignalHash), byColor.black.map(value => value.networkSignalHash)).length) {
    signals.push({ code: 'shared_network_signal', weight: evidence.money ? 30 : 15, detail: 'Opponents shared a pseudonymous network-prefix signal. Shared homes/networks are possible, so this requires context.' });
  }

  if (relationship && evidence.money && relationship.moneyGames >= 2) {
    signals.push({ code: 'repeated_money_opponents', weight: 25, detail: `These accounts had ${relationship.moneyGames} prior funded games recorded before this game.` });
  } else if (relationship && evidence.tournamentId && relationship.tournamentGames >= 4) {
    signals.push({ code: 'repeated_tournament_opponents', weight: 10, detail: `These accounts had ${relationship.tournamentGames} prior tournament games recorded before this game.` });
  }

  const nonOpening = evidence.moves.filter(move => move.ply > 12 && move.complexity.pieceCount >= 10);
  const ultrafast = nonOpening.filter(move => move.thinkTimeMs >= 0 && move.thinkTimeMs <= 250);
  if (ultrafast.length >= 6 && ultrafast.length / Math.max(1, nonOpening.length) >= 0.35) {
    signals.push({ code: 'ultrafast_move_cluster', weight: 20, detail: `${ultrafast.length} non-opening moves were committed in 250 ms or less. Premoves, forced lines, and network behavior must be considered in review.` });
  }

  const playerTimes = (color: 'white' | 'black') => evidence.moves.filter(move => move.color === color && move.ply > 12).map(move => move.thinkTimeMs).filter(value => value >= 100);
  for (const color of ['white', 'black'] as const) {
    const values = playerTimes(color);
    if (values.length >= 12 && timingVariation(values) < 0.08) {
      signals.push({ code: 'ultrafast_move_cluster', weight: 10, detail: `${color} showed unusually regular post-opening move timing. This is a weak behavioral signal only.` });
    }
  }

  const timestampAnomalies = evidence.moves.filter(move => move.clientToServerMs !== null && (move.clientToServerMs < -10_000 || move.clientToServerMs > 86_400_000)).length;
  if (timestampAnomalies >= 3) {
    signals.push({ code: 'client_timestamp_anomalies', weight: 10, detail: `${timestampAnomalies} client timestamps were implausibly far from authoritative receive time. Client clocks are never trusted for adjudication.` });
  }

  const score = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const threshold = evidence.money ? 40 : evidence.tournamentId ? 55 : 80;
  return { score, threshold, signals };
}

function retentionClass(evidence: IntegrityGameEvidence): GameSummary['retentionClass'] {
  if (evidence.money) return 'money_730d';
  if (evidence.tournamentId) return 'tournament_365d';
  return 'casual_90d';
}

function unresolved(status: IntegrityReviewStatus): boolean {
  return status !== 'cleared';
}

export class IntegrityReviewRegistry extends DurableObject<IntegrityRegistryEnv> {
  private internalAuthorized(request: Request): boolean {
    const secret = this.env.INTEGRITY_INTERNAL_SECRET ?? '';
    return Boolean(secret) && request.headers.get('x-integrity-internal') === secret;
  }

  private adminAuthorized(request: Request): boolean {
    const secret = this.env.INTEGRITY_ADMIN_SECRET ?? '';
    return secret.length >= 24 && request.headers.get('x-integrity-admin') === secret;
  }

  private async relationshipFor(evidence: IntegrityGameEvidence): Promise<{ key: string; value: Relationship } | null> {
    const key = pairKey(evidence.players);
    if (!key) return null;
    const ids = key.split(':');
    const value = (await this.ctx.storage.get<Relationship>(`${REL_PREFIX}${key}`)) ?? {
      accountA: ids[0], accountB: ids[1], games: 0, moneyGames: 0, tournamentGames: 0, lastPlayedAt: 0, gameIds: [],
    };
    return { key, value };
  }

  private async ingest(request: Request): Promise<Response> {
    if (!this.internalAuthorized(request)) return json({ error: 'Unauthorized integrity ingestion.' }, 401);
    const evidence = await request.json().catch(() => null) as IntegrityGameEvidence | null;
    if (!evidence || evidence.schema !== 'qqurz-integrity-game-v1' || !clean(evidence.gameId, 180) || !clean(evidence.roomCode, 12) || !Array.isArray(evidence.moves) || evidence.moves.length > 500) {
      return json({ error: 'Invalid integrity game evidence.' }, 400);
    }
    const gameKey = `${GAME_PREFIX}${evidence.gameId}`;
    const existing = await this.ctx.storage.get<GameSummary>(gameKey);
    if (existing) return json(await this.settlementDisposition(existing.gameId));

    const relation = await this.relationshipFor(evidence);
    const assessment = triage(evidence, relation?.value ?? null);
    let reviewCase: IntegrityReviewCase | null = null;
    if (assessment.score >= assessment.threshold) {
      const now = Date.now();
      reviewCase = {
        id: `review_${crypto.randomUUID().replaceAll('-', '')}`,
        gameId: evidence.gameId,
        roomCode: evidence.roomCode,
        tournamentId: evidence.tournamentId,
        money: evidence.money,
        priority: evidence.money ? 'high' : evidence.tournamentId ? 'medium' : 'standard',
        status: 'queued',
        score: assessment.score,
        threshold: assessment.threshold,
        signals: assessment.signals,
        createdAt: now,
        updatedAt: now,
        reviewers: [],
        notes: [],
        disclaimer: 'Automated triage only. A case is not a cheating finding. Engine correlation alone must not be used as an automatic accusation or penalty.',
      };
    }

    const summary: GameSummary = {
      ...evidence,
      moves: undefined as never,
      connections: undefined as never,
      moveCount: evidence.moves.length,
      connectionCount: evidence.connections.length,
      retentionClass: retentionClass(evidence),
      reviewCaseId: reviewCase?.id ?? null,
      triageScore: assessment.score,
    };
    delete (summary as unknown as Record<string, unknown>).moves;
    delete (summary as unknown as Record<string, unknown>).connections;

    const puts: Record<string, unknown> = {
      [gameKey]: summary,
      [`${gameKey}:connections`]: evidence.connections.slice(0, 100),
    };
    evidence.moves.forEach((_, index) => {
      if (index % MOVE_CHUNK_SIZE !== 0) return;
      puts[`${gameKey}:moves:${Math.floor(index / MOVE_CHUNK_SIZE)}`] = evidence.moves.slice(index, index + MOVE_CHUNK_SIZE);
    });
    if (reviewCase) {
      puts[`${CASE_PREFIX}${reviewCase.id}`] = reviewCase;
      const index = (await this.ctx.storage.get<string[]>(CASE_INDEX)) ?? [];
      puts[CASE_INDEX] = [reviewCase.id, ...index.filter(id => id !== reviewCase!.id)].slice(0, MAX_CASE_INDEX);
      if (evidence.tournamentId) {
        const key = `integrity:tournament-cases:v1:${evidence.tournamentId}`;
        const cases = (await this.ctx.storage.get<string[]>(key)) ?? [];
        puts[key] = [reviewCase.id, ...cases.filter(id => id !== reviewCase!.id)].slice(0, 500);
      }
    }
    if (relation) {
      puts[`${REL_PREFIX}${relation.key}`] = {
        ...relation.value,
        games: relation.value.games + 1,
        moneyGames: relation.value.moneyGames + (evidence.money ? 1 : 0),
        tournamentGames: relation.value.tournamentGames + (evidence.tournamentId ? 1 : 0),
        lastPlayedAt: evidence.finalizedAt,
        gameIds: [evidence.gameId, ...relation.value.gameIds.filter(id => id !== evidence.gameId)].slice(0, 100),
      } satisfies Relationship;
    }
    await this.ctx.storage.put(puts);
    return json(await this.settlementDisposition(evidence.gameId), 201);
  }

  private async settlementDisposition(gameId: string): Promise<IntegritySettlementDisposition> {
    const summary = await this.ctx.storage.get<GameSummary>(`${GAME_PREFIX}${gameId}`);
    if (!summary) return { gameId, disposition: 'manual_review', reviewCaseId: null, reason: 'Integrity evidence has not been recorded yet.' };
    if (!summary.reviewCaseId) return { gameId, disposition: 'allow', reviewCaseId: null, reason: null };
    const review = await this.ctx.storage.get<IntegrityReviewCase>(`${CASE_PREFIX}${summary.reviewCaseId}`);
    if (!review || review.status === 'cleared') return { gameId, disposition: 'allow', reviewCaseId: summary.reviewCaseId, reason: null };
    return { gameId, disposition: summary.money ? 'manual_review' : 'allow', reviewCaseId: summary.reviewCaseId, reason: summary.money ? 'Funded settlement requires integrity review before money is released.' : null };
  }

  private async tournamentStatus(tournamentId: string): Promise<Response> {
    const caseIds = (await this.ctx.storage.get<string[]>(`integrity:tournament-cases:v1:${tournamentId}`)) ?? [];
    const cases = (await Promise.all(caseIds.map(id => this.ctx.storage.get<IntegrityReviewCase>(`${CASE_PREFIX}${id}`)))).filter((value): value is IntegrityReviewCase => Boolean(value));
    const open = cases.filter(item => unresolved(item.status));
    return json({ tournamentId, disposition: open.length ? 'manual_review' : 'allow', openCases: open.map(item => ({ id: item.id, gameId: item.gameId, priority: item.priority, status: item.status, score: item.score })) });
  }

  private async adminList(request: Request): Promise<Response> {
    if (!this.adminAuthorized(request)) return json({ error: 'Unauthorized integrity review access.' }, 401);
    const url = new URL(request.url);
    const requested = clean(url.searchParams.get('status'), 32);
    const ids = (await this.ctx.storage.get<string[]>(CASE_INDEX)) ?? [];
    const cases = (await Promise.all(ids.slice(0, 250).map(id => this.ctx.storage.get<IntegrityReviewCase>(`${CASE_PREFIX}${id}`)))).filter((value): value is IntegrityReviewCase => Boolean(value));
    return json({ cases: requested ? cases.filter(item => item.status === requested) : cases });
  }

  private async adminGame(request: Request, gameId: string): Promise<Response> {
    if (!this.adminAuthorized(request)) return json({ error: 'Unauthorized integrity review access.' }, 401);
    const key = `${GAME_PREFIX}${gameId}`;
    const summary = await this.ctx.storage.get<GameSummary>(key);
    if (!summary) return json({ error: 'Integrity game record not found.' }, 404);
    const moves: IntegrityMoveEvidence[] = [];
    for (let index = 0; index < Math.ceil(summary.moveCount / MOVE_CHUNK_SIZE); index += 1) {
      moves.push(...((await this.ctx.storage.get<IntegrityMoveEvidence[]>(`${key}:moves:${index}`)) ?? []));
    }
    const connections = (await this.ctx.storage.get<IntegrityConnectionSignal[]>(`${key}:connections`)) ?? [];
    const review = summary.reviewCaseId ? await this.ctx.storage.get<IntegrityReviewCase>(`${CASE_PREFIX}${summary.reviewCaseId}`) : null;
    return json({ game: summary, moves, connections, review });
  }

  private async adminDecision(request: Request, caseId: string): Promise<Response> {
    if (!this.adminAuthorized(request)) return json({ error: 'Unauthorized integrity review access.' }, 401);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const reviewerId = clean(body.reviewerId, 80);
    const note = clean(body.note, 500);
    const decision = clean(body.decision, 32);
    if (!reviewerId || !note || !['clear', 'escalate', 'action_required'].includes(decision)) return json({ error: 'Reviewer, note and a supported decision are required.' }, 400);
    const key = `${CASE_PREFIX}${caseId}`;
    const review = await this.ctx.storage.get<IntegrityReviewCase>(key);
    if (!review) return json({ error: 'Review case not found.' }, 404);
    const now = Date.now();
    if (!review.reviewers.includes(reviewerId)) review.reviewers.push(reviewerId);
    review.notes.push({ reviewerId, note, at: now });
    if (decision === 'clear') review.status = 'cleared';
    else if (decision === 'escalate') review.status = 'escalated';
    else if (review.money && new Set(review.reviewers).size < 2) review.status = 'second_review';
    else review.status = 'action_required';
    review.updatedAt = now;
    await this.ctx.storage.put(key, review);
    return json({ review, adverseActionAuthorized: review.status === 'action_required', requiresSecondReviewer: review.status === 'second_review' });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/game-complete' && request.method === 'POST') return this.ingest(request);
    if (url.pathname.startsWith('/internal/game-status/') && request.method === 'GET') {
      if (!this.internalAuthorized(request)) return json({ error: 'Unauthorized integrity status request.' }, 401);
      return json(await this.settlementDisposition(decodeURIComponent(url.pathname.slice('/internal/game-status/'.length))));
    }
    if (url.pathname.startsWith('/internal/tournament-status/') && request.method === 'GET') {
      if (!this.internalAuthorized(request)) return json({ error: 'Unauthorized integrity status request.' }, 401);
      return this.tournamentStatus(decodeURIComponent(url.pathname.slice('/internal/tournament-status/'.length)));
    }
    if (url.pathname === '/admin/reviews' && request.method === 'GET') return this.adminList(request);
    const game = /^\/admin\/games\/(.+)$/.exec(url.pathname);
    if (game && request.method === 'GET') return this.adminGame(request, decodeURIComponent(game[1]));
    const decision = /^\/admin\/reviews\/([^/]+)\/decision$/.exec(url.pathname);
    if (decision && request.method === 'POST') return this.adminDecision(request, decodeURIComponent(decision[1]));
    return json({ error: 'Integrity route not found.' }, 404);
  }
}

function registry(env: IntegrityEnv): DurableObjectStub<IntegrityReviewRegistry> {
  return env.INTEGRITY.get(env.INTEGRITY.idFromName('qqurz-integrity-review-registry-v1'));
}

function internalHeaders(env: IntegrityEnv): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-integrity-internal', env.INTEGRITY_INTERNAL_SECRET ?? '');
  return headers;
}

export async function submitIntegrityGame(env: IntegrityEnv, evidence: IntegrityGameEvidence): Promise<IntegritySettlementDisposition> {
  if (!env.INTEGRITY_INTERNAL_SECRET) return { gameId: evidence.gameId, disposition: evidence.money ? 'manual_review' : 'allow', reviewCaseId: null, reason: 'Integrity service is not configured.' };
  const response = await registry(env).fetch(new Request('https://integrity.internal/internal/game-complete', {
    method: 'POST', headers: internalHeaders(env), body: JSON.stringify(evidence),
  }));
  const body = await response.json().catch(() => ({})) as Partial<IntegritySettlementDisposition> & { error?: string };
  if (!response.ok) return { gameId: evidence.gameId, disposition: evidence.money ? 'manual_review' : 'allow', reviewCaseId: null, reason: body.error ?? 'Integrity review service rejected the game evidence.' };
  return { gameId: evidence.gameId, disposition: body.disposition === 'manual_review' ? 'manual_review' : 'allow', reviewCaseId: body.reviewCaseId ?? null, reason: body.reason ?? null };
}

export async function tournamentIntegrityStatus(env: IntegrityEnv, tournamentId: string): Promise<{ disposition: 'allow' | 'manual_review'; openCases: unknown[]; error?: string }> {
  if (!env.INTEGRITY_INTERNAL_SECRET) return { disposition: 'manual_review', openCases: [], error: 'Integrity service is not configured.' };
  const response = await registry(env).fetch(new Request(`https://integrity.internal/internal/tournament-status/${encodeURIComponent(tournamentId)}`, { headers: internalHeaders(env) }));
  const body = await response.json().catch(() => ({})) as { disposition?: string; openCases?: unknown[]; error?: string };
  if (!response.ok) return { disposition: 'manual_review', openCases: [], error: body.error ?? 'Tournament integrity status is unavailable.' };
  return { disposition: body.disposition === 'manual_review' ? 'manual_review' : 'allow', openCases: body.openCases ?? [] };
}

export async function handleIntegrityAdminRequest(request: Request, env: IntegrityEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/integrity/admin/')) return null;
  const target = url.pathname.replace('/integrity', '');
  const headers = new Headers(request.headers);
  headers.set('x-integrity-admin', request.headers.get('x-integrity-admin') ?? '');
  return registry(env).fetch(new Request(`https://integrity.internal${target}${url.search}`, { method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body }));
}
