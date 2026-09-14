import { DurableObject } from 'cloudflare:workers';
import type { CanonicalLedgerTransaction, DataCommand, DataCommandBatch } from './model';
import { ensureProductionDataSchema, LATEST_DATA_SCHEMA_VERSION, REQUIRED_PRODUCTION_DATA_TABLES } from './migrations';

export type DataModelEnv = {
  DATA: DurableObjectNamespace<DataRegistry>;
};

const GLOBAL_DATA_OBJECT = 'qqurz-global-relational-data-v1';
const MAX_COMMANDS_PER_REQUEST = 100;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function jsonText(value: unknown): string { try { return JSON.stringify(value ?? {}); } catch { return '{}'; } }
function bool(value: boolean | undefined, fallback = false): number { return (value ?? fallback) ? 1 : 0; }
function finite(value: number | null | undefined): number | null { return Number.isFinite(value) ? Number(value) : null; }
function integer(value: number | null | undefined, fallback = 0): number { return Number.isSafeInteger(value) ? Number(value) : fallback; }
function safeKey(value: string, max = 220): string { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max); }

function validateLedger(transaction: CanonicalLedgerTransaction): void {
  if (!transaction.id || !transaction.idempotencyKey) throw new Error('Ledger transaction requires id and idempotency key.');
  if (!Array.isArray(transaction.entries) || transaction.entries.length < 2) throw new Error('Ledger transaction requires at least two entries.');
  let sum = 0;
  for (const entry of transaction.entries) {
    if (!entry.walletAccountId || !Number.isSafeInteger(entry.amountCents) || entry.amountCents === 0) throw new Error('Ledger entries require non-zero integer cents.');
    sum += entry.amountCents;
  }
  if (!Number.isSafeInteger(sum) || sum !== 0) throw new Error('Double-entry ledger transaction must balance to zero cents.');
}

export function dataRegistryStub(env: DataModelEnv): DurableObjectStub<DataRegistry> {
  return env.DATA.get(env.DATA.idFromName(GLOBAL_DATA_OBJECT));
}

export async function applyDataCommands(env: DataModelEnv, commands: DataCommand[]): Promise<void> {
  for (let offset = 0; offset < commands.length; offset += MAX_COMMANDS_PER_REQUEST) {
    const batch = commands.slice(offset, offset + MAX_COMMANDS_PER_REQUEST);
    const response = await dataRegistryStub(env).fetch(new Request('https://data.internal/internal/model/commands', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commands: batch } satisfies DataCommandBatch),
    }));
    if (!response.ok) throw new Error(`Canonical data write failed (${response.status}): ${await response.text()}`);
  }
}

export class DataRegistry extends DurableObject<DataModelEnv> {
  private schemaVersion = LATEST_DATA_SCHEMA_VERSION;

  constructor(ctx: DurableObjectState, env: DataModelEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.schemaVersion = ensureProductionDataSchema(this.ctx.storage);
    });
  }

  private syncUser(command: Extract<DataCommand, { type: 'sync_user' }>): void {
    const user = command.user;
    const now = user.updatedAt || Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec(
      `INSERT INTO users(id,email,status,email_verified_at,created_at,updated_at,deleted_at)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET email=excluded.email,status=excluded.status,email_verified_at=excluded.email_verified_at,
         updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`,
      user.id, user.email.toLowerCase(), user.status ?? 'active', finite(user.emailVerifiedAt), user.createdAt, now, finite(user.deletedAt),
    );
    sql.exec(
      `INSERT INTO profiles(user_id,username,display_name,country_code,avatar,avatar_image,language,timezone,privacy_json,notification_settings_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,country_code=excluded.country_code,
         avatar=excluded.avatar,avatar_image=excluded.avatar_image,language=excluded.language,timezone=excluded.timezone,
         privacy_json=excluded.privacy_json,notification_settings_json=excluded.notification_settings_json,updated_at=excluded.updated_at`,
      user.id, user.profile.username, user.profile.displayName, user.profile.countryCode ?? '', user.profile.avatar ?? '♞', user.profile.avatarImage ?? null,
      user.profile.language ?? 'en', user.profile.timezone ?? 'auto', jsonText(user.profile.privacy), jsonText(user.profile.notificationSettings), user.createdAt, now,
    );
    if (user.passwordIdentity) {
      const identity = user.passwordIdentity;
      sql.exec(
        `INSERT INTO auth_identities(id,user_id,provider,provider_subject,email_normalized,credential_hash,credential_salt,credential_iterations,created_at,last_used_at,disabled_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,NULL)
         ON CONFLICT(provider,provider_subject) DO UPDATE SET user_id=excluded.user_id,email_normalized=excluded.email_normalized,
           credential_hash=excluded.credential_hash,credential_salt=excluded.credential_salt,credential_iterations=excluded.credential_iterations,last_used_at=excluded.last_used_at`,
        identity.id ?? `password:${user.id}`, user.id, 'password', identity.providerSubject, user.email.toLowerCase(), identity.credentialHash,
        identity.credentialSalt, identity.credentialIterations, user.createdAt, finite(identity.lastUsedAt),
      );
    } else if (user.status === 'deleted') {
      sql.exec(`UPDATE auth_identities SET disabled_at=COALESCE(disabled_at,?) WHERE user_id=?`, now, user.id);
    }
    for (const rating of user.ratings ?? []) {
      sql.exec(
        `INSERT INTO ratings(user_id,pool,rating,deviation,volatility,rated_games,last_rated_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id,pool) DO UPDATE SET rating=excluded.rating,deviation=excluded.deviation,volatility=excluded.volatility,
           rated_games=excluded.rated_games,last_rated_at=excluded.last_rated_at,updated_at=excluded.updated_at`,
        user.id, rating.pool, rating.rating, rating.deviation, rating.volatility, integer(rating.ratedGames), finite(rating.lastRatedAt), now,
      );
    }
  }

  private upsertSession(command: Extract<DataCommand, { type: 'upsert_session' }>): void {
    const row = command.session;
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions(id,user_id,token_hash,device_record_id,user_agent,ip_prefix,created_at,last_seen_at,expires_at,revoked_at,revoke_reason)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,device_record_id=excluded.device_record_id,user_agent=excluded.user_agent,
         ip_prefix=excluded.ip_prefix,last_seen_at=excluded.last_seen_at,expires_at=excluded.expires_at,revoked_at=excluded.revoked_at,revoke_reason=excluded.revoke_reason`,
      row.id, row.userId, row.tokenHash, row.deviceRecordId ?? null, row.userAgent ?? '', row.ipPrefix ?? '', row.createdAt, row.lastSeenAt, row.expiresAt,
      finite(row.revokedAt), row.revokeReason ?? null,
    );
  }

  private recordGame(command: Extract<DataCommand, { type: 'record_game' }>): void {
    const game = command.game;
    const sql = this.ctx.storage.sql;
    sql.exec(
      `INSERT INTO games(id,room_code,status,result_kind,result_text,winner_user_id,position_id,initial_fen,final_fen,base_ms,increment_ms,rated,rating_pool,tournament_id,tournament_round_id,pairing_id,created_at,started_at,ended_at,metadata_json)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status,result_kind=excluded.result_kind,result_text=excluded.result_text,winner_user_id=excluded.winner_user_id,
         final_fen=excluded.final_fen,rated=excluded.rated,rating_pool=excluded.rating_pool,tournament_id=COALESCE(excluded.tournament_id,games.tournament_id),
         tournament_round_id=COALESCE(excluded.tournament_round_id,games.tournament_round_id),pairing_id=COALESCE(excluded.pairing_id,games.pairing_id),
         started_at=COALESCE(games.started_at,excluded.started_at),ended_at=excluded.ended_at,metadata_json=excluded.metadata_json`,
      game.id, game.roomCode ?? null, game.status, game.resultKind ?? null, game.resultText ?? null, game.winnerUserId ?? null, finite(game.positionId),
      game.initialFen ?? null, game.finalFen ?? null, integer(game.baseMs), integer(game.incrementMs), bool(game.rated), game.ratingPool ?? null,
      game.tournamentId ?? null, game.tournamentRoundId ?? null, game.pairingId ?? null, game.createdAt, finite(game.startedAt), finite(game.endedAt), jsonText(game.metadata),
    );
    for (const p of game.participants) {
      sql.exec(
        `INSERT INTO game_participants(id,game_id,user_id,seat_no,color,display_name_snapshot,outcome,rating_pool,rating_before,rating_after,rating_deviation_before,rating_deviation_after,joined_at,left_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(game_id,seat_no) DO UPDATE SET user_id=excluded.user_id,color=excluded.color,display_name_snapshot=excluded.display_name_snapshot,
           outcome=excluded.outcome,rating_pool=excluded.rating_pool,rating_before=COALESCE(excluded.rating_before,game_participants.rating_before),rating_after=COALESCE(excluded.rating_after,game_participants.rating_after),
           rating_deviation_before=COALESCE(excluded.rating_deviation_before,game_participants.rating_deviation_before),rating_deviation_after=COALESCE(excluded.rating_deviation_after,game_participants.rating_deviation_after),left_at=excluded.left_at`,
        p.id ?? `${game.id}:${p.color}`, game.id, p.userId ?? null, p.seatNo, p.color, p.displayName, p.outcome ?? null, p.ratingPool ?? null,
        finite(p.ratingBefore), finite(p.ratingAfter), finite(p.ratingDeviationBefore), finite(p.ratingDeviationAfter), finite(p.joinedAt), finite(p.leftAt),
      );
    }
    for (const move of game.moves ?? []) {
      sql.exec(
        `INSERT INTO game_moves(game_id,ply,mover_user_id,mover_color,uci,san,fen_after,client_sent_at,server_received_at,committed_at,think_ms,clock_after_ms,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(game_id,ply) DO UPDATE SET mover_user_id=excluded.mover_user_id,uci=COALESCE(excluded.uci,game_moves.uci),san=excluded.san,fen_after=COALESCE(excluded.fen_after,game_moves.fen_after),
           client_sent_at=COALESCE(excluded.client_sent_at,game_moves.client_sent_at),server_received_at=COALESCE(excluded.server_received_at,game_moves.server_received_at),
           committed_at=COALESCE(excluded.committed_at,game_moves.committed_at),think_ms=COALESCE(excluded.think_ms,game_moves.think_ms),clock_after_ms=COALESCE(excluded.clock_after_ms,game_moves.clock_after_ms)`,
        game.id, move.ply, move.moverUserId ?? null, move.moverColor, move.uci ?? null, move.san, move.fenAfter ?? null, finite(move.clientSentAt),
        finite(move.serverReceivedAt), finite(move.committedAt), finite(move.thinkMs), finite(move.clockAfterMs), move.createdAt ?? game.endedAt ?? Date.now(),
      );
    }
  }

  private upsertTournament(command: Extract<DataCommand, { type: 'upsert_tournament' }>): void {
    const t = command.tournament;
    this.ctx.storage.sql.exec(
      `INSERT INTO tournaments(id,slug,name,format,status,visibility,rated,capacity,entry_fee_cents,currency,starts_at,ends_at,current_round,created_by_user_id,rules_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,format=excluded.format,status=excluded.status,visibility=excluded.visibility,
         rated=excluded.rated,capacity=excluded.capacity,entry_fee_cents=excluded.entry_fee_cents,currency=excluded.currency,starts_at=excluded.starts_at,
         ends_at=excluded.ends_at,current_round=excluded.current_round,rules_json=excluded.rules_json,updated_at=excluded.updated_at`,
      t.id, t.slug ?? null, t.name, t.format, t.status, t.visibility ?? 'public', bool(t.rated, true), finite(t.capacity), integer(t.entryFeeCents),
      t.currency ?? 'USD', finite(t.startsAt), finite(t.endsAt), integer(t.currentRound), t.createdByUserId ?? null, jsonText(t.rules), t.createdAt, t.updatedAt,
    );
  }

  private applyLedger(command: Extract<DataCommand, { type: 'ledger_transaction' }>): void {
    const tx = command.transaction;
    validateLedger(tx);
    const scope = safeKey(tx.idempotencyScope ?? 'global', 120) || 'global';
    const scopedKey = `${scope}:${safeKey(tx.idempotencyKey)}`.slice(0, 500);
    const cursor = this.ctx.storage.sql.exec(
      `INSERT INTO ledger_transactions(id,transaction_type,purpose,reference,idempotency_key,provider,provider_reference,status,sequence,previous_hash,hash,metadata_json,created_at,reversed_by_transaction_id,idempotency_scope)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
      tx.id, tx.transactionType, tx.purpose, tx.reference ?? '', scopedKey, tx.provider ?? null, tx.providerReference ?? null, tx.status ?? 'posted',
      finite(tx.sequence), tx.previousHash ?? null, tx.hash ?? null, jsonText({ ...(tx.metadata && typeof tx.metadata === 'object' ? tx.metadata as object : {}), originalIdempotencyKey: tx.idempotencyKey }),
      tx.createdAt, tx.reversedByTransactionId ?? null, scope,
    );
    if (cursor.rowsWritten === 0) return;
    for (const entry of tx.entries) {
      this.ctx.storage.sql.exec(
        `INSERT INTO ledger_entries(transaction_id,wallet_account_id,bucket,amount_cents,created_at) VALUES(?,?,?,?,?)`,
        tx.id, entry.walletAccountId, entry.bucket, entry.amountCents, tx.createdAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO wallet_balances(wallet_account_id,bucket,balance_cents,sequence,last_hash,updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(wallet_account_id,bucket) DO UPDATE SET balance_cents=wallet_balances.balance_cents + excluded.balance_cents,
           sequence=MAX(wallet_balances.sequence,excluded.sequence),last_hash=CASE WHEN excluded.last_hash<>'' THEN excluded.last_hash ELSE wallet_balances.last_hash END,updated_at=excluded.updated_at`,
        entry.walletAccountId, entry.bucket, entry.amountCents, integer(tx.sequence), tx.hash ?? '', tx.createdAt,
      );
    }
  }

  private applyCommand(command: DataCommand): void {
    const sql = this.ctx.storage.sql;
    switch (command.type) {
      case 'sync_user': return this.syncUser(command);
      case 'auth_token': {
        const t = command.token;
        sql.exec(`INSERT INTO auth_tokens(id,user_id,kind,token_hash,created_at,expires_at,consumed_at) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET consumed_at=excluded.consumed_at`,t.id,t.userId,t.kind,t.tokenHash,t.createdAt,t.expiresAt,finite(t.consumedAt)); return;
      }
      case 'upsert_session': return this.upsertSession(command);
      case 'revoke_session': sql.exec(`UPDATE sessions SET revoked_at=?,revoke_reason=? WHERE id=?`, command.revokedAt, command.reason ?? null, command.sessionId); return;
      case 'record_game': return this.recordGame(command);
      case 'upsert_tournament': return this.upsertTournament(command);
      case 'upsert_tournament_registration': {
        const r = command.registration;
        sql.exec(`INSERT INTO tournament_registrations(id,tournament_id,user_id,status,seed,registered_at,checked_in_at,withdrawn_at,payment_intent_id,entry_ledger_transaction_id,metadata_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tournament_id,user_id) DO UPDATE SET status=excluded.status,seed=excluded.seed,checked_in_at=excluded.checked_in_at,
          withdrawn_at=excluded.withdrawn_at,payment_intent_id=excluded.payment_intent_id,entry_ledger_transaction_id=excluded.entry_ledger_transaction_id,metadata_json=excluded.metadata_json`,
          r.id,r.tournamentId,r.userId,r.status,finite(r.seed),r.registeredAt,finite(r.checkedInAt),finite(r.withdrawnAt),r.paymentIntentId ?? null,r.entryLedgerTransactionId ?? null,jsonText(r.metadata)); return;
      }
      case 'upsert_tournament_round': {
        const r = command.round;
        sql.exec(`INSERT INTO tournament_rounds(id,tournament_id,round_number,status,starts_at,ends_at,locked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(tournament_id,round_number) DO UPDATE SET status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,locked_at=excluded.locked_at,updated_at=excluded.updated_at`,
          r.id,r.tournamentId,r.roundNumber,r.status,finite(r.startsAt),finite(r.endsAt),finite(r.lockedAt),r.createdAt,r.updatedAt); return;
      }
      case 'upsert_tournament_pairing': {
        const p = command.pairing;
        sql.exec(`INSERT INTO tournament_pairings(id,tournament_id,round_id,board_number,white_user_id,black_user_id,game_id,status,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET white_user_id=excluded.white_user_id,black_user_id=excluded.black_user_id,game_id=excluded.game_id,status=excluded.status,result=excluded.result,updated_at=excluded.updated_at`,
          p.id,p.tournamentId,p.roundId,p.boardNumber,p.whiteUserId ?? null,p.blackUserId ?? null,p.gameId ?? null,p.status,p.result ?? null,p.createdAt,p.updatedAt); return;
      }
      case 'upsert_tournament_standing': {
        const s = command.standing;
        sql.exec(`INSERT INTO tournament_standings(tournament_id,user_id,rank,points_half,buchholz_half,sonneborn_berger_half,wins,draws,losses,byes,games_played,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(tournament_id,user_id) DO UPDATE SET rank=excluded.rank,points_half=excluded.points_half,buchholz_half=excluded.buchholz_half,
          sonneborn_berger_half=excluded.sonneborn_berger_half,wins=excluded.wins,draws=excluded.draws,losses=excluded.losses,byes=excluded.byes,games_played=excluded.games_played,updated_at=excluded.updated_at`,
          s.tournamentId,s.userId,s.rank,s.pointsHalf,integer(s.buchholzHalf),integer(s.sonnebornBergerHalf),integer(s.wins),integer(s.draws),integer(s.losses),integer(s.byes),integer(s.gamesPlayed),s.updatedAt); return;
      }
      case 'follow':
        if (command.followerUserId === command.followedUserId) throw new Error('A user cannot follow themselves.');
        if (!command.active) sql.exec(`DELETE FROM follows WHERE follower_user_id=? AND followed_user_id=?`,command.followerUserId,command.followedUserId);
        else sql.exec(`INSERT INTO follows(follower_user_id,followed_user_id,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(follower_user_id,followed_user_id) DO UPDATE SET updated_at=excluded.updated_at`,command.followerUserId,command.followedUserId,command.at,command.at);
        return;
      case 'friendship': {
        const [a,b] = [command.userAId,command.userBId].sort();
        if (a === b) throw new Error('Friendship cannot reference the same user.');
        if (!command.active) sql.exec(`DELETE FROM friendships WHERE user_a_id=? AND user_b_id=?`,a,b);
        else sql.exec(`INSERT INTO friendships(user_a_id,user_b_id,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_a_id,user_b_id) DO UPDATE SET updated_at=excluded.updated_at`,a,b,command.at,command.at);
        return;
      }
      case 'friend_invite': {
        const i = command.invite;
        sql.exec(`INSERT INTO friend_invites(id,from_user_id,to_user_id,status,created_at,responded_at,expires_at,metadata_json) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET status=excluded.status,responded_at=excluded.responded_at,expires_at=excluded.expires_at,metadata_json=excluded.metadata_json`,
          i.id,i.fromUserId,i.toUserId,i.status,i.createdAt,finite(i.respondedAt),finite(i.expiresAt),jsonText(i.metadata)); return;
      }
      case 'player_block':
        if (command.active) sql.exec(`INSERT OR IGNORE INTO player_blocks(blocker_user_id,blocked_user_id,created_at) VALUES(?,?,?)`,command.blockerUserId,command.blockedUserId,command.at);
        else sql.exec(`DELETE FROM player_blocks WHERE blocker_user_id=? AND blocked_user_id=?`,command.blockerUserId,command.blockedUserId);
        return;
      case 'payment_customer': { const c=command.customer; sql.exec(`INSERT INTO payment_customers(id,user_id,provider,provider_customer_id,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET provider_customer_id=excluded.provider_customer_id,updated_at=excluded.updated_at`,c.id,c.userId,c.provider,c.providerCustomerId,c.createdAt,c.updatedAt); return; }
      case 'payment_intent': { const i=command.intent; sql.exec(`INSERT INTO payment_intents(id,user_id,customer_id,provider,provider_intent_id,purpose,amount_cents,currency,status,idempotency_key,game_id,tournament_id,metadata_json,created_at,updated_at,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO UPDATE SET provider_intent_id=excluded.provider_intent_id,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at,confirmed_at=excluded.confirmed_at`,i.id,i.userId ?? null,i.customerId ?? null,i.provider,i.providerIntentId ?? null,i.purpose,i.amountCents,i.currency ?? 'USD',i.status,i.idempotencyKey,i.gameId ?? null,i.tournamentId ?? null,jsonText(i.metadata),i.createdAt,i.updatedAt,finite(i.confirmedAt)); return; }
      case 'wallet_account': { const w=command.wallet; sql.exec(`INSERT INTO wallet_accounts(id,user_id,account_type,currency,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`,w.id,w.userId ?? null,w.accountType,w.currency ?? 'USD',w.status ?? 'open',w.createdAt,w.updatedAt); return; }
      case 'ledger_transaction': return this.applyLedger(command);
      case 'payout': { const p=command.payout; sql.exec(`INSERT INTO payouts(id,user_id,wallet_account_id,provider,provider_payout_id,amount_cents,currency,status,idempotency_key,requested_at,processed_at,failure_reason,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO UPDATE SET provider_payout_id=excluded.provider_payout_id,status=excluded.status,processed_at=excluded.processed_at,failure_reason=excluded.failure_reason,metadata_json=excluded.metadata_json`,p.id,p.userId,p.walletAccountId,p.provider,p.providerPayoutId ?? null,p.amountCents,p.currency ?? 'USD',p.status,p.idempotencyKey,p.requestedAt,finite(p.processedAt),p.failureReason ?? null,jsonText(p.metadata)); return; }
      case 'refund': { const r=command.refund; sql.exec(`INSERT INTO refunds(id,user_id,payment_intent_id,ledger_transaction_id,provider,provider_refund_id,amount_cents,currency,status,reason,idempotency_key,created_at,processed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO UPDATE SET provider_refund_id=excluded.provider_refund_id,status=excluded.status,processed_at=excluded.processed_at`,r.id,r.userId ?? null,r.paymentIntentId ?? null,r.ledgerTransactionId ?? null,r.provider,r.providerRefundId ?? null,r.amountCents,r.currency ?? 'USD',r.status,r.reason ?? '',r.idempotencyKey,r.createdAt,finite(r.processedAt)); return; }
      case 'subscription': { const s=command.subscription; sql.exec(`INSERT INTO subscriptions(id,user_id,provider,provider_subscription_id,plan_key,status,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider_subscription_id=excluded.provider_subscription_id,plan_key=excluded.plan_key,status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=excluded.updated_at`,s.id,s.userId,s.provider,s.providerSubscriptionId ?? null,s.planKey,s.status,finite(s.currentPeriodStart),finite(s.currentPeriodEnd),bool(s.cancelAtPeriodEnd),s.createdAt,s.updatedAt); return; }
      case 'entitlement': { const e=command.entitlement; sql.exec(`INSERT INTO premium_entitlements(id,user_id,entitlement_key,source_type,source_id,status,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=excluded.updated_at`,e.id,e.userId,e.entitlementKey,e.sourceType,e.sourceId ?? null,e.status,e.startsAt,finite(e.endsAt),e.createdAt,e.updatedAt); return; }
      case 'compliance_attestation': { const a=command.attestation; sql.exec(`INSERT INTO compliance_attestations(id,user_id,provider,provider_reference,country_code,region_code,identity_verified,age_verified,verified_age,tax_profile_verified,status,created_at,updated_at,expires_at,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider_reference=excluded.provider_reference,country_code=excluded.country_code,region_code=excluded.region_code,identity_verified=excluded.identity_verified,age_verified=excluded.age_verified,verified_age=excluded.verified_age,tax_profile_verified=excluded.tax_profile_verified,status=excluded.status,updated_at=excluded.updated_at,expires_at=excluded.expires_at,metadata_json=excluded.metadata_json`,a.id,a.userId,a.provider,a.providerReference ?? null,a.countryCode ?? '',a.regionCode ?? '',bool(a.identityVerified),bool(a.ageVerified),finite(a.verifiedAge),bool(a.taxProfileVerified),a.status,a.createdAt,a.updatedAt,finite(a.expiresAt),jsonText(a.metadata)); return; }
      case 'moderation_report': { const r=command.report; sql.exec(`INSERT INTO moderation_reports(id,reporter_user_id,target_user_id,game_id,tournament_id,category,narrative,status,priority,created_at,updated_at,reviewed_at,reviewed_by_user_id,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,priority=excluded.priority,updated_at=excluded.updated_at,reviewed_at=excluded.reviewed_at,reviewed_by_user_id=excluded.reviewed_by_user_id,metadata_json=excluded.metadata_json`,r.id,r.reporterUserId ?? null,r.targetUserId ?? null,r.gameId ?? null,r.tournamentId ?? null,r.category,r.narrative ?? '',r.status,integer(r.priority),r.createdAt,r.updatedAt,finite(r.reviewedAt),r.reviewedByUserId ?? null,jsonText(r.metadata)); return; }
      case 'moderation_record': { const r=command.record; sql.exec(`INSERT INTO moderation_records(id,user_id,report_id,action,reason,starts_at,ends_at,created_at,created_by_user_id,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ends_at=excluded.ends_at,metadata_json=excluded.metadata_json`,r.id,r.userId ?? null,r.reportId ?? null,r.action,r.reason,r.startsAt,finite(r.endsAt),r.createdAt,r.createdByUserId ?? null,jsonText(r.metadata)); return; }
      case 'device': { const d=command.device; sql.exec(`INSERT INTO device_records(id,user_id,fingerprint_hash,device_name,platform,browser,first_seen_at,last_seen_at,trusted_at,revoked_at,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,device_name=excluded.device_name,platform=excluded.platform,browser=excluded.browser,last_seen_at=excluded.last_seen_at,trusted_at=excluded.trusted_at,revoked_at=excluded.revoked_at,metadata_json=excluded.metadata_json`,d.id,d.userId ?? null,d.fingerprintHash ?? null,d.deviceName ?? '',d.platform ?? '',d.browser ?? '',d.firstSeenAt,d.lastSeenAt,finite(d.trustedAt),finite(d.revokedAt),jsonText(d.metadata)); return; }
      case 'security_event': { const e=command.event; sql.exec(`INSERT OR IGNORE INTO security_events(id,user_id,session_id,device_record_id,event_type,success,risk_score,ip_prefix,user_agent,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,e.id,e.userId ?? null,e.sessionId ?? null,e.deviceRecordId ?? null,e.eventType,bool(e.success,true),Math.max(0,Math.min(100,integer(e.riskScore))),e.ipPrefix ?? '',e.userAgent ?? '',jsonText(e.metadata),e.createdAt); return; }
      case 'notification': { const n=command.notification; sql.exec(`INSERT OR IGNORE INTO notifications(id,user_id,notification_type,title,body,data_json,dedupe_key,created_at,read_at,delivered_at,push_attempted_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,n.id,n.userId,n.notificationType,n.title,n.body,jsonText(n.data),n.dedupeKey ?? null,n.createdAt,finite(n.readAt),finite(n.deliveredAt),finite(n.pushAttemptedAt),finite(n.expiresAt)); sql.exec(`UPDATE notifications SET read_at=?,delivered_at=?,push_attempted_at=?,expires_at=? WHERE id=?`,finite(n.readAt),finite(n.deliveredAt),finite(n.pushAttemptedAt),finite(n.expiresAt),n.id); return; }
      case 'audit': { const e=command.event; sql.exec(`INSERT OR IGNORE INTO audit_logs(event_id,actor_user_id,actor_type,action,entity_type,entity_id,request_id,ip_prefix,before_json,after_json,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,e.eventId,e.actorUserId ?? null,e.actorType,e.action,e.entityType,e.entityId,e.requestId ?? null,e.ipPrefix ?? '',e.before === undefined ? null : jsonText(e.before),e.after === undefined ? null : jsonText(e.after),jsonText(e.metadata),e.createdAt); return; }
      default: throw new Error(`Unsupported canonical command: ${(command as { type?: string }).type ?? 'unknown'}`);
    }
  }

  private applyBatch(batch: DataCommandBatch): Response {
    if (!Array.isArray(batch.commands) || batch.commands.length === 0) return json({ error: 'No commands.' }, 400);
    if (batch.commands.length > MAX_COMMANDS_PER_REQUEST) return json({ error: `Too many commands; max ${MAX_COMMANDS_PER_REQUEST}.` }, 413);
    try {
      this.ctx.storage.transactionSync(() => { for (const command of batch.commands) this.applyCommand(command); });
      return json({ ok: true, applied: batch.commands.length, schemaVersion: this.schemaVersion });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Canonical data write failed.' }, 409);
    }
  }

  private health(): Response {
    const rows = this.ctx.storage.sql.exec(`SELECT name FROM sqlite_master WHERE type='table'`).toArray() as Array<{ name: string }>;
    const names = new Set(rows.map(row => row.name));
    const missing = REQUIRED_PRODUCTION_DATA_TABLES.filter(name => !names.has(name));
    const integrity = this.ctx.storage.sql.exec(`PRAGMA integrity_check`).one() as { integrity_check?: string } | null;
    return json({ ok: missing.length === 0 && integrity?.integrity_check === 'ok', schemaVersion: this.schemaVersion, tables: REQUIRED_PRODUCTION_DATA_TABLES.length, missing, integrity: integrity?.integrity_check ?? 'unknown' });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/model/health' && request.method === 'GET') return this.health();
    if (url.pathname === '/internal/model/commands' && request.method === 'POST') {
      const batch = await request.json().catch(() => ({ commands: [] })) as DataCommandBatch;
      return this.applyBatch(batch);
    }
    return json({ error: 'Not found.' }, 404);
  }
}
