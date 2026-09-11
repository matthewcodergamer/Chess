import { ratingClassForTimeControl } from '../../shared/timeControl';
import { recordAccountTournament } from './accounts';
import { ViewingTournamentRegistry } from './tournamentViewing';
import type { TournamentEngineEnv } from './tournamentEngineApi';
import {
  ENGINE_ID_PATTERN,
  checkInCloseAt,
  checkInOpenAt,
  cleanTournamentTitle,
  createTournamentDefinition,
  hashInviteCode,
  isRoundComplete,
  participantId,
  registrationCloseAt,
  startDeadline,
  tournamentIndexItem,
  type Color,
  type EnginePairing,
  type EngineRound,
  type EngineTournament,
} from './tournamentEngineTypes';
import { makeRound, publicPairing, scoreFromWinner, seedPlayers, standingsFor } from './tournamentPairing';
import { buildPayoutLedger, publicParticipant, tournamentDetail } from './tournamentEngineView';
import { launchTournamentRoom } from './tournamentRoomLauncher';

const INDEX_KEY = 'engine:tournament-index:v1';
const TOURNAMENT_KEY = 'engine:tournament:v1:';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export class EngineTournamentRegistry extends ViewingTournamentRegistry {
  private internals(): { ctx: DurableObjectState; env: TournamentEngineEnv } {
    return this as unknown as { ctx: DurableObjectState; env: TournamentEngineEnv };
  }

  private async loadIndex(): Promise<string[]> {
    return (await this.internals().ctx.storage.get<string[]>(INDEX_KEY)) ?? [];
  }

  private async loadTournament(id: string): Promise<EngineTournament | null> {
    return (await this.internals().ctx.storage.get<EngineTournament>(`${TOURNAMENT_KEY}${id}`)) ?? null;
  }

  private async saveTournament(tournament: EngineTournament): Promise<void> {
    tournament.updatedAt = Date.now();
    const { ctx } = this.internals();
    await ctx.storage.put(`${TOURNAMENT_KEY}${tournament.id}`, tournament);
    const index = await this.loadIndex();
    if (!index.includes(tournament.id)) await ctx.storage.put(INDEX_KEY, [tournament.id, ...index].slice(0, 500));
  }

  private currentRating(tournament: EngineTournament, ratings: Record<string, any> | undefined): number {
    const ratingClass = ratingClassForTimeControl(tournament.timeControl.baseMs, tournament.timeControl.incrementMs);
    const value = Number(ratings?.[ratingClass]?.rating);
    return Number.isFinite(value) && value >= 100 && value <= 5000 ? Math.round(value) : 1500;
  }

  private livePayoutAllowed(): boolean {
    const { env } = this.internals();
    return env.LIVE_TOURNAMENT_PAYMENTS === 'enabled' && env.PAYMENTS_MODE === 'live';
  }

  private async recordViewingStart(tournament: EngineTournament, round: EngineRound, pairing: EnginePairing): Promise<void> {
    if (!pairing.roomCode || !pairing.blackId) return;
    const white = tournament.participants[pairing.whiteId];
    const black = tournament.participants[pairing.blackId];
    if (!white || !black) return;
    await super.fetch(new Request('https://tournament.internal/view-game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tournamentId: tournament.id,
        roomCode: pairing.roomCode,
        round: round.number,
        white: { name: white.name, rating: white.rating, accountId: white.accountId },
        black: { name: black.name, rating: black.rating, accountId: black.accountId },
        startedAt: pairing.launchedAt,
      }),
    }));
  }

  private async launchRound(tournament: EngineTournament, round: EngineRound): Promise<void> {
    round.status = 'active';
    tournament.status = 'round_active';
    tournament.currentRound = round.number;
    for (const pairing of round.pairings) {
      if (pairing.status !== 'pending' && pairing.status !== 'launch_error') continue;
      try {
        await launchTournamentRoom(this.internals().env, tournament, round, pairing);
        await this.recordViewingStart(tournament, round, pairing);
      } catch (error) {
        pairing.status = 'launch_error';
        pairing.launchError = error instanceof Error ? error.message : 'Room launch failed.';
      }
    }
  }

  private async completeTournament(tournament: EngineTournament, now: number): Promise<void> {
    tournament.status = 'completed';
    tournament.completedAt = now;
    tournament.finalStandings = standingsFor(tournament);
    const payout = buildPayoutLedger(tournament, this.livePayoutAllowed());
    tournament.payoutLedger = payout.ledger;
    tournament.payoutStatus = payout.status;
    for (const row of tournament.finalStandings) {
      const participant = tournament.participants[row.participantId];
      if (!participant) continue;
      try {
        await recordAccountTournament(this.internals().env, {
          accountId: participant.accountId,
          tournamentId: tournament.id,
          name: tournament.title,
          status: 'complete',
          placement: row.rank,
        });
      } catch {
        // Profile history is supplemental. Never block tournament completion.
      }
    }
  }

  private async startTournament(tournament: EngineTournament, now: number): Promise<void> {
    if (!['registration', 'check_in', 'seeding'].includes(tournament.status)) return;
    tournament.status = 'seeding';
    const players = seedPlayers(tournament);
    const eligible = new Set(players.map(player => player.id));
    for (const participant of Object.values(tournament.participants)) {
      if (!eligible.has(participant.id)) participant.status = 'withdrawn';
    }
    if (players.length < 2) {
      tournament.status = 'cancelled';
      tournament.cancellationReason = 'Not enough checked-in players to start.';
      tournament.completedAt = now;
      const payout = buildPayoutLedger(tournament, this.livePayoutAllowed());
      tournament.payoutLedger = payout.ledger;
      tournament.payoutStatus = payout.status;
      return;
    }
    tournament.startedAt = now;
    const first = makeRound(tournament, 1, players);
    tournament.rounds = [first];
    await this.launchRound(tournament, first);
    if (isRoundComplete(first)) await this.advanceAfterRound(tournament, first, now);
  }

  private async advanceAfterRound(tournament: EngineTournament, round: EngineRound, now: number): Promise<void> {
    if (!isRoundComplete(round)) return;
    round.status = 'complete';
    round.completedAt = now;
    tournament.status = 'between_rounds';
    const shouldComplete = tournament.format === 'single_elimination'
      ? round.pairings.filter(pairing => pairing.winnerId).length <= 1
      : round.number >= tournament.roundCount;
    if (shouldComplete) {
      await this.completeTournament(tournament, now);
      return;
    }
    const players = Object.values(tournament.participants).filter(player => player.status === 'active');
    const next = makeRound(tournament, round.number + 1, players);
    tournament.rounds.push(next);
    await this.launchRound(tournament, next);
    if (isRoundComplete(next)) await this.advanceAfterRound(tournament, next, now);
  }

  private async applyRoomResult(tournament: EngineTournament, body: Record<string, unknown>): Promise<void> {
    const code = String(body.roomCode ?? '').trim().toUpperCase();
    const round = tournament.rounds.find(value => value.pairings.some(pairing => pairing.roomCode === code));
    const pairing = round?.pairings.find(value => value.roomCode === code);
    if (!round || !pairing || !pairing.blackId) return;
    if (body.complete !== true && !body.result) return;
    if (pairing.status === 'verified') return;

    const winnerColor: Color | null = body.winner === 'white' || body.winner === 'black' ? body.winner : null;
    const winnerId = winnerColor === 'white' ? pairing.whiteId : winnerColor === 'black' ? pairing.blackId : null;
    const now = Date.now();
    pairing.attempts.push({
      roomCode: code,
      whiteId: pairing.whiteId,
      blackId: pairing.blackId,
      positionId: pairing.positionId,
      result: String(body.result ?? 'Game complete').slice(0, 180),
      winnerId,
      completedAt: now,
    });

    if (tournament.format === 'single_elimination' && !winnerId) {
      const previousWhite = pairing.whiteId;
      pairing.whiteId = pairing.blackId;
      pairing.blackId = previousWhite;
      pairing.roomCode = null;
      pairing.whiteSeatToken = null;
      pairing.blackSeatToken = null;
      pairing.status = 'pending';
      pairing.result = 'Draw — rematch required';
      pairing.winnerId = null;
      pairing.whiteScore = null;
      pairing.blackScore = null;
      pairing.completedAt = null;
      try {
        await launchTournamentRoom(this.internals().env, tournament, round, pairing);
        await this.recordViewingStart(tournament, round, pairing);
      } catch (error) {
        pairing.status = 'launch_error';
        pairing.launchError = error instanceof Error ? error.message : 'Rematch launch failed.';
      }
      return;
    }

    const score = scoreFromWinner(winnerColor);
    pairing.status = 'verified';
    pairing.result = String(body.result ?? 'Game complete').slice(0, 180);
    pairing.winnerId = winnerId;
    pairing.whiteScore = score.white;
    pairing.blackScore = score.black;
    pairing.completedAt = now;
    pairing.launchError = null;

    if (tournament.format === 'single_elimination' && winnerId) {
      const loserId = winnerId === pairing.whiteId ? pairing.blackId : pairing.whiteId;
      const loser = tournament.participants[loserId];
      if (loser) {
        loser.status = 'eliminated';
        loser.eliminatedRound = round.number;
      }
    }
    if (isRoundComplete(round)) await this.advanceAfterRound(tournament, round, now);
  }

  private async transition(tournament: EngineTournament, now = Date.now()): Promise<void> {
    if (tournament.status === 'completed' || tournament.status === 'cancelled') return;
    if (tournament.status === 'registration' && tournament.checkInRules.required && now >= checkInOpenAt(tournament)) {
      tournament.status = 'check_in';
    }
    if (['registration', 'check_in'].includes(tournament.status) && now >= startDeadline(tournament)) {
      await this.startTournament(tournament, now);
    }
    if (tournament.status === 'round_active') {
      const round = tournament.rounds.find(value => value.number === tournament.currentRound);
      if (!round) return;
      for (const pairing of round.pairings.filter(value => value.status === 'launch_error')) {
        try {
          await launchTournamentRoom(this.internals().env, tournament, round, pairing);
          await this.recordViewingStart(tournament, round, pairing);
        } catch {
          // Retry on the next engine alarm or request.
        }
      }
      if (isRoundComplete(round)) await this.advanceAfterRound(tournament, round, now);
    }
  }

  private async scheduleAlarm(): Promise<void> {
    const { ctx } = this.internals();
    const ids = await this.loadIndex();
    const now = Date.now();
    let next: number | null = null;
    for (const id of ids) {
      const tournament = await this.loadTournament(id);
      if (!tournament || tournament.status === 'completed' || tournament.status === 'cancelled') continue;
      const candidates: number[] = [];
      if (tournament.status === 'registration' && tournament.checkInRules.required) candidates.push(checkInOpenAt(tournament));
      if (['registration', 'check_in'].includes(tournament.status)) candidates.push(startDeadline(tournament));
      if (tournament.status === 'round_active' && tournament.rounds.some(round => round.pairings.some(pairing => pairing.status === 'launch_error'))) candidates.push(now + 10_000);
      for (const candidate of candidates) {
        if (candidate > now && (next === null || candidate < next)) next = candidate;
      }
    }
    if (next === null) await ctx.storage.deleteAlarm();
    else await ctx.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    for (const id of await this.loadIndex()) {
      const tournament = await this.loadTournament(id);
      if (!tournament) continue;
      await this.transition(tournament);
      await this.saveTournament(tournament);
    }
    await this.scheduleAlarm();
  }

  private async createTournament(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as { organizerAccountId?: string; organizerName?: string; definition?: Record<string, unknown> };
    if (!body.organizerAccountId) return json({ error: 'Organizer account is required.' }, 401);
    try {
      const tournament = createTournamentDefinition(body.definition ?? {}, body.organizerAccountId, body.organizerName ?? 'Organizer');
      const entry = body.definition?.entryRules && typeof body.definition.entryRules === 'object' ? body.definition.entryRules as Record<string, unknown> : {};
      if (tournament.entryRules.mode === 'invite') {
        const inviteCode = String(entry.inviteCode ?? '').trim();
        if (inviteCode.length < 4) return json({ error: 'Invite-only tournaments need an invite code of at least 4 characters.' }, 400);
        tournament.entryRules.inviteCodeHash = await hashInviteCode(inviteCode);
      }
      await this.saveTournament(tournament);
      await this.scheduleAlarm();
      return json({ tournament: tournamentDetail(tournament) }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Tournament definition is invalid.' }, 400);
    }
  }

  private async register(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as Record<string, any>;
    const tournament = await this.loadTournament(String(body.id ?? ''));
    if (!tournament) return json({ error: 'Tournament not found.' }, 404);
    await this.transition(tournament);
    const now = Date.now();
    if (!['registration', 'check_in'].includes(tournament.status) || now >= registrationCloseAt(tournament)) return json({ error: 'Registration is closed.' }, 409);
    const activeCount = Object.values(tournament.participants).filter(player => player.status !== 'withdrawn').length;
    if (activeCount >= tournament.capacity) return json({ error: 'Tournament is full.' }, 409);
    if (tournament.entryRules.requiresVerifiedAccount && !body.emailVerifiedAt) return json({ error: 'Verify your account email before entering this tournament.' }, 403);
    if (tournament.entryRules.mode === 'invite') {
      const candidate = await hashInviteCode(String(body.inviteCode ?? ''));
      if (!tournament.entryRules.inviteCodeHash || candidate !== tournament.entryRules.inviteCodeHash) return json({ error: 'The tournament invite code is incorrect.' }, 403);
    }
    const ratingClass = ratingClassForTimeControl(tournament.timeControl.baseMs, tournament.timeControl.incrementMs);
    const rating = this.currentRating(tournament, body.ratings);
    if (tournament.entryRules.minRating !== null && rating < tournament.entryRules.minRating) return json({ error: `Minimum rating is ${tournament.entryRules.minRating}.` }, 403);
    if (tournament.entryRules.maxRating !== null && rating > tournament.entryRules.maxRating) return json({ error: `Maximum rating is ${tournament.entryRules.maxRating}.` }, 403);
    if (!body.accountId) return json({ error: 'Account identity is required.' }, 401);
    const id = participantId(String(body.accountId));
    const existing = tournament.participants[id];
    if (existing) {
      existing.name = cleanTournamentTitle(body.name).slice(0, 40);
      existing.rating = rating;
      existing.ratingClass = ratingClass;
      if (existing.status === 'withdrawn') existing.status = 'registered';
    } else {
      tournament.participants[id] = {
        id,
        accountId: String(body.accountId),
        name: cleanTournamentTitle(body.name).slice(0, 40),
        rating,
        ratingClass,
        registeredAt: now,
        checkedInAt: null,
        seed: null,
        status: 'registered',
        eliminatedRound: null,
      };
    }
    await this.saveTournament(tournament);
    await this.scheduleAlarm();
    try {
      await recordAccountTournament(this.internals().env, { accountId: String(body.accountId), tournamentId: tournament.id, name: tournament.title, registeredAt: now, status: 'registered' });
    } catch { /* supplemental */ }
    return json({ tournament: tournamentDetail(tournament), participant: publicParticipant(tournament.participants[id]) });
  }

  private async checkIn(request: Request): Promise<Response> {
    const body = await request.json().catch(() => ({})) as Record<string, any>;
    const tournament = await this.loadTournament(String(body.id ?? ''));
    if (!tournament) return json({ error: 'Tournament not found.' }, 404);
    await this.transition(tournament);
    const id = participantId(String(body.accountId ?? ''));
    const participant = tournament.participants[id];
    if (!participant) return json({ error: 'Register before checking in.' }, 404);
    const now = Date.now();
    if (tournament.checkInRules.required && (now < checkInOpenAt(tournament) || now > checkInCloseAt(tournament))) return json({ error: 'Check-in is not open.' }, 409);
    participant.checkedInAt = now;
    participant.status = 'checked_in';
    await this.saveTournament(tournament);
    await this.scheduleAlarm();
    return json({ tournament: tournamentDetail(tournament), participant: publicParticipant(participant) });
  }

  private async organizerAction(request: Request, action: 'start' | 'advance' | 'cancel'): Promise<Response> {
    const body = await request.json().catch(() => ({})) as Record<string, any>;
    const tournament = await this.loadTournament(String(body.id ?? ''));
    if (!tournament) return json({ error: 'Tournament not found.' }, 404);
    if (tournament.organizerAccountId !== body.accountId) return json({ error: 'Only the tournament organizer can do that.' }, 403);
    if (action === 'cancel') {
      if (tournament.status === 'completed') return json({ error: 'A completed tournament cannot be cancelled.' }, 409);
      tournament.status = 'cancelled';
      tournament.cancellationReason = 'Cancelled by organizer';
      tournament.completedAt = Date.now();
      const payout = buildPayoutLedger(tournament, this.livePayoutAllowed());
      tournament.payoutLedger = payout.ledger;
      tournament.payoutStatus = payout.status;
    } else if (action === 'start') {
      await this.startTournament(tournament, Date.now());
    } else {
      const round = tournament.rounds.find(value => value.number === tournament.currentRound);
      if (!round || !isRoundComplete(round)) return json({ error: 'The current round still has unverified games.' }, 409);
      await this.advanceAfterRound(tournament, round, Date.now());
    }
    await this.saveTournament(tournament);
    await this.scheduleAlarm();
    return json({ tournament: tournamentDetail(tournament) });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== 'tournament.internal') return super.fetch(request);

    if (request.method === 'POST' && url.pathname === '/view-game') {
      const body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
      const id = String(body.tournamentId ?? '');
      const tournament = ENGINE_ID_PATTERN.test(id) ? await this.loadTournament(id) : null;
      if (!tournament) return super.fetch(request);
      const code = String(body.roomCode ?? '').trim().toUpperCase();
      const round = tournament.rounds.find(value => value.pairings.some(pairing => pairing.roomCode === code));
      if (round) body.round = round.number;
      await this.applyRoomResult(tournament, body);
      await this.saveTournament(tournament);
      await this.scheduleAlarm();
      return super.fetch(new Request('https://tournament.internal/view-game', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }));
    }

    if (request.method === 'GET' && url.pathname === '/view') {
      const response = await super.fetch(request);
      if (!response.ok) return response;
      const id = url.searchParams.get('tournamentId') ?? '';
      const tournament = ENGINE_ID_PATTERN.test(id) ? await this.loadTournament(id) : null;
      if (!tournament) return response;
      const payload = await response.json() as Record<string, unknown>;
      return json({ ...payload, standings: tournament.finalStandings ?? standingsFor(tournament), engineStatus: tournament.status, currentRound: tournament.currentRound, roundCount: tournament.roundCount });
    }

    if (request.method === 'GET' && url.pathname === '/engine/list') {
      const tournaments = [];
      for (const id of await this.loadIndex()) {
        const tournament = await this.loadTournament(id);
        if (!tournament) continue;
        await this.transition(tournament);
        await this.saveTournament(tournament);
        tournaments.push(tournamentIndexItem(tournament));
      }
      tournaments.sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0) || a.startTime - b.startTime || b.createdAt - a.createdAt);
      await this.scheduleAlarm();
      return json({ tournaments, serverNow: Date.now() });
    }

    if (request.method === 'GET' && url.pathname === '/engine/detail') {
      const tournament = await this.loadTournament(url.searchParams.get('id') ?? '');
      if (!tournament) return json({ error: 'Tournament not found.' }, 404);
      await this.transition(tournament);
      await this.saveTournament(tournament);
      await this.scheduleAlarm();
      return json({ tournament: tournamentDetail(tournament) });
    }

    if (request.method === 'POST' && url.pathname === '/engine/create') return this.createTournament(request);
    if (request.method === 'POST' && url.pathname === '/engine/register') return this.register(request);
    if (request.method === 'POST' && url.pathname === '/engine/check-in') return this.checkIn(request);
    if (request.method === 'POST' && url.pathname === '/engine/start') return this.organizerAction(request, 'start');
    if (request.method === 'POST' && url.pathname === '/engine/advance') return this.organizerAction(request, 'advance');
    if (request.method === 'POST' && url.pathname === '/engine/cancel') return this.organizerAction(request, 'cancel');

    if (request.method === 'GET' && url.pathname === '/engine/me') {
      const tournament = await this.loadTournament(url.searchParams.get('id') ?? '');
      if (!tournament) return json({ error: 'Tournament not found.' }, 404);
      await this.transition(tournament);
      await this.saveTournament(tournament);
      const id = participantId(url.searchParams.get('accountId') ?? '');
      const participant = tournament.participants[id] ?? null;
      const currentRound = tournament.rounds.find(round => round.number === tournament.currentRound);
      const pairing = currentRound?.pairings.find(row => row.whiteId === id || row.blackId === id) ?? null;
      let seat = null;
      if (pairing?.roomCode && pairing.status === 'live') {
        if (pairing.whiteId === id && pairing.whiteSeatToken) seat = { code: pairing.roomCode, token: pairing.whiteSeatToken, color: 'white' as const };
        if (pairing.blackId === id && pairing.blackSeatToken) seat = { code: pairing.roomCode, token: pairing.blackSeatToken, color: 'black' as const };
      }
      return json({ participant: participant ? publicParticipant(participant) : null, seat, pairing: pairing ? publicPairing(pairing, tournament) : null, tournament: tournamentIndexItem(tournament), serverNow: Date.now() });
    }

    return super.fetch(request);
  }
}
