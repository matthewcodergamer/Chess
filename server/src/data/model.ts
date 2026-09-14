export type CanonicalRating = {
  pool: 'chess960_rapid' | 'chess960_blitz' | 'chess960_bullet' | 'chess960_correspondence';
  rating: number;
  deviation: number;
  volatility: number;
  ratedGames?: number;
  lastRatedAt?: number | null;
};

export type CanonicalUser = {
  id: string;
  email: string;
  status?: 'active' | 'disabled' | 'deleted';
  emailVerifiedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  profile: {
    username: string;
    displayName: string;
    countryCode?: string;
    avatar?: string;
    avatarImage?: string | null;
    language?: string;
    timezone?: string;
    privacy?: unknown;
    notificationSettings?: unknown;
  };
  passwordIdentity?: {
    id?: string;
    providerSubject: string;
    credentialHash: string;
    credentialSalt: string;
    credentialIterations: number;
    lastUsedAt?: number | null;
  };
  ratings?: CanonicalRating[];
};

export type CanonicalSession = {
  id: string;
  userId: string;
  tokenHash: string;
  deviceRecordId?: string | null;
  userAgent?: string;
  ipPrefix?: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  revokedAt?: number | null;
  revokeReason?: string | null;
};

export type CanonicalGame = {
  id: string;
  roomCode?: string | null;
  status: 'created' | 'active' | 'paused' | 'completed' | 'aborted' | 'void';
  resultKind?: string | null;
  resultText?: string | null;
  winnerUserId?: string | null;
  positionId?: number | null;
  initialFen?: string | null;
  finalFen?: string | null;
  baseMs: number;
  incrementMs: number;
  rated: boolean;
  ratingPool?: string | null;
  tournamentId?: string | null;
  tournamentRoundId?: string | null;
  pairingId?: string | null;
  createdAt: number;
  startedAt?: number | null;
  endedAt?: number | null;
  metadata?: unknown;
  participants: Array<{
    id?: string;
    userId?: string | null;
    seatNo: 1 | 2;
    color: 'white' | 'black';
    displayName: string;
    outcome?: 'win' | 'loss' | 'draw' | 'void' | null;
    ratingPool?: string | null;
    ratingBefore?: number | null;
    ratingAfter?: number | null;
    ratingDeviationBefore?: number | null;
    ratingDeviationAfter?: number | null;
    joinedAt?: number | null;
    leftAt?: number | null;
  }>;
  moves?: Array<{
    ply: number;
    moverUserId?: string | null;
    moverColor: 'white' | 'black';
    uci?: string | null;
    san: string;
    fenAfter?: string | null;
    clientSentAt?: number | null;
    serverReceivedAt?: number | null;
    committedAt?: number | null;
    thinkMs?: number | null;
    clockAfterMs?: number | null;
    createdAt?: number;
  }>;
};

export type CanonicalTournament = {
  id: string;
  slug?: string | null;
  name: string;
  format: string;
  status: 'draft' | 'registration' | 'running' | 'paused' | 'completed' | 'cancelled';
  visibility?: 'public' | 'unlisted' | 'private';
  rated?: boolean;
  capacity?: number | null;
  entryFeeCents?: number;
  currency?: string;
  startsAt?: number | null;
  endsAt?: number | null;
  currentRound?: number;
  createdByUserId?: string | null;
  rules?: unknown;
  createdAt: number;
  updatedAt: number;
};

export type TournamentRegistration = {
  id: string;
  tournamentId: string;
  userId: string;
  status: 'registered' | 'checked_in' | 'active' | 'withdrawn' | 'eliminated' | 'completed' | 'refunded';
  seed?: number | null;
  registeredAt: number;
  checkedInAt?: number | null;
  withdrawnAt?: number | null;
  paymentIntentId?: string | null;
  entryLedgerTransactionId?: string | null;
  metadata?: unknown;
};

export type TournamentRound = {
  id: string;
  tournamentId: string;
  roundNumber: number;
  status: 'pending' | 'pairing' | 'active' | 'complete' | 'cancelled';
  startsAt?: number | null;
  endsAt?: number | null;
  lockedAt?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type TournamentPairing = {
  id: string;
  tournamentId: string;
  roundId: string;
  boardNumber: number;
  whiteUserId?: string | null;
  blackUserId?: string | null;
  gameId?: string | null;
  status: 'pending' | 'ready' | 'active' | 'complete' | 'forfeit' | 'bye' | 'cancelled';
  result?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TournamentStanding = {
  tournamentId: string;
  userId: string;
  rank: number;
  pointsHalf: number;
  buchholzHalf?: number;
  sonnebornBergerHalf?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  byes?: number;
  gamesPlayed?: number;
  updatedAt: number;
};

export type LedgerEntryInput = {
  walletAccountId: string;
  bucket: 'available' | 'held' | 'pending_withdrawal' | 'debt' | 'revenue' | 'escrow' | 'external';
  amountCents: number;
};

export type CanonicalLedgerTransaction = {
  id: string;
  transactionType: string;
  purpose: string;
  reference?: string;
  idempotencyKey: string;
  provider?: string | null;
  providerReference?: string | null;
  status?: 'pending' | 'posted' | 'reversed' | 'void';
  sequence?: number | null;
  previousHash?: string | null;
  hash?: string | null;
  metadata?: unknown;
  createdAt: number;
  reversedByTransactionId?: string | null;
  entries: LedgerEntryInput[];
};

export type DataCommand =
  | { type: 'sync_user'; user: CanonicalUser }
  | { type: 'upsert_session'; session: CanonicalSession }
  | { type: 'revoke_session'; sessionId: string; revokedAt: number; reason?: string | null }
  | { type: 'record_game'; game: CanonicalGame }
  | { type: 'upsert_tournament'; tournament: CanonicalTournament }
  | { type: 'upsert_tournament_registration'; registration: TournamentRegistration }
  | { type: 'upsert_tournament_round'; round: TournamentRound }
  | { type: 'upsert_tournament_pairing'; pairing: TournamentPairing }
  | { type: 'upsert_tournament_standing'; standing: TournamentStanding }
  | { type: 'friendship'; userAId: string; userBId: string; active: boolean; at: number }
  | { type: 'friend_invite'; invite: { id: string; fromUserId: string; toUserId: string; status: 'pending'|'accepted'|'declined'|'cancelled'|'expired'; createdAt: number; respondedAt?: number|null; expiresAt?: number|null; metadata?: unknown } }
  | { type: 'player_block'; blockerUserId: string; blockedUserId: string; active: boolean; at: number }
  | { type: 'payment_customer'; customer: { id: string; userId: string; provider: string; providerCustomerId: string; createdAt: number; updatedAt: number } }
  | { type: 'payment_intent'; intent: { id: string; userId?: string|null; customerId?: string|null; provider: string; providerIntentId?: string|null; purpose: string; amountCents: number; currency?: string; status: 'created'|'pending'|'requires_action'|'authorized'|'captured'|'failed'|'cancelled'|'refunded'|'partially_refunded'; idempotencyKey: string; gameId?: string|null; tournamentId?: string|null; metadata?: unknown; createdAt: number; updatedAt: number; confirmedAt?: number|null } }
  | { type: 'wallet_account'; wallet: { id: string; userId?: string|null; accountType: 'user'|'platform_revenue'|'escrow'|'external_clearing'; currency?: string; status?: 'open'|'frozen'|'closed'; createdAt: number; updatedAt: number } }
  | { type: 'ledger_transaction'; transaction: CanonicalLedgerTransaction }
  | { type: 'payout'; payout: { id: string; userId: string; walletAccountId: string; provider: string; providerPayoutId?: string|null; amountCents: number; currency?: string; status: 'requested'|'review'|'submitted'|'paid'|'failed'|'cancelled'|'reversed'; idempotencyKey: string; requestedAt: number; processedAt?: number|null; failureReason?: string|null; metadata?: unknown } }
  | { type: 'refund'; refund: { id: string; userId?: string|null; paymentIntentId?: string|null; ledgerTransactionId?: string|null; provider: string; providerRefundId?: string|null; amountCents: number; currency?: string; status: 'pending'|'submitted'|'succeeded'|'failed'|'cancelled'; reason?: string; idempotencyKey: string; createdAt: number; processedAt?: number|null } }
  | { type: 'subscription'; subscription: { id: string; userId: string; provider: string; providerSubscriptionId?: string|null; planKey: string; status: 'trialing'|'active'|'past_due'|'paused'|'cancelled'|'expired'; currentPeriodStart?: number|null; currentPeriodEnd?: number|null; cancelAtPeriodEnd?: boolean; createdAt: number; updatedAt: number } }
  | { type: 'entitlement'; entitlement: { id: string; userId: string; entitlementKey: string; sourceType: 'purchase'|'subscription'|'grant'|'promotion'; sourceId?: string|null; status: 'active'|'revoked'|'expired'; startsAt: number; endsAt?: number|null; createdAt: number; updatedAt: number } }
  | { type: 'moderation_report'; report: { id: string; reporterUserId?: string|null; targetUserId?: string|null; gameId?: string|null; tournamentId?: string|null; category: string; narrative?: string; status: 'open'|'triaged'|'reviewing'|'resolved'|'dismissed'; priority?: number; createdAt: number; updatedAt: number; reviewedAt?: number|null; reviewedByUserId?: string|null; metadata?: unknown } }
  | { type: 'moderation_record'; record: { id: string; userId?: string|null; reportId?: string|null; action: string; reason: string; startsAt: number; endsAt?: number|null; createdAt: number; createdByUserId?: string|null; metadata?: unknown } }
  | { type: 'device'; device: { id: string; userId?: string|null; fingerprintHash?: string|null; deviceName?: string; platform?: string; browser?: string; firstSeenAt: number; lastSeenAt: number; trustedAt?: number|null; revokedAt?: number|null; metadata?: unknown } }
  | { type: 'security_event'; event: { id: string; userId?: string|null; sessionId?: string|null; deviceRecordId?: string|null; eventType: string; success?: boolean; riskScore?: number; ipPrefix?: string; userAgent?: string; metadata?: unknown; createdAt: number } }
  | { type: 'notification'; notification: { id: string; userId: string; notificationType: string; title: string; body: string; data?: unknown; dedupeKey?: string|null; createdAt: number; readAt?: number|null; deliveredAt?: number|null; pushAttemptedAt?: number|null; expiresAt?: number|null } }
  | { type: 'audit'; event: { eventId: string; actorUserId?: string|null; actorType: 'user'|'system'|'moderator'|'provider'|'worker'; action: string; entityType: string; entityId: string; requestId?: string|null; ipPrefix?: string; before?: unknown; after?: unknown; metadata?: unknown; createdAt: number } };

export type DataCommandBatch = { commands: DataCommand[] };
