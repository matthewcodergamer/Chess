export type MoneyPurpose =
  | 'wallet_deposit'
  | 'friend_match_entry'
  | 'friend_match_prize'
  | 'tournament_entry'
  | 'tournament_prize'
  | 'color_bid'
  | 'position_bid'
  | 'premium_purchase'
  | 'refund'
  | 'withdrawal';

export type CompetitionProvider = 'nuvei' | 'approved_provider';

export type JurisdictionPolicy = {
  enabled: boolean;
  minAge: number;
  provider: CompetitionProvider;
  deposits: boolean;
  friendMatches: boolean;
  tournamentEntries: boolean;
  tournamentPrizes: boolean;
  withdrawals: boolean;
  taxProfileRequired: boolean;
  legalReviewId: string;
  providerApprovalId: string;
  reviewedAt: string;
  expiresAt?: string;
};

export type ComplianceProfile = {
  accountId: string;
  identityVerifiedAt: number | null;
  ageVerifiedAt: number | null;
  verifiedAge: number | null;
  countryCode: string;
  regionCode: string;
  taxProfileVerifiedAt: number | null;
  sanctionsCheckedAt: number | null;
  providerCustomerId: string | null;
  updatedAt: number;
};

export type PaymentPolicyEnv = {
  REAL_MONEY_ENABLED?: string;
  REAL_MONEY_JURISDICTIONS_JSON?: string;
};

export type PolicyDecision = {
  allowed: boolean;
  jurisdiction: string;
  reason: string | null;
  policy: JurisdictionPolicy | null;
};

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
}

export function jurisdictionKey(profile: Pick<ComplianceProfile, 'countryCode' | 'regionCode'>): string {
  const country = normalizeCode(profile.countryCode);
  const region = normalizeCode(profile.regionCode);
  if (!country) return '';
  return region ? `${country}-${region}` : country;
}

export function parseJurisdictionPolicies(env: PaymentPolicyEnv): Record<string, JurisdictionPolicy> {
  if (env.REAL_MONEY_ENABLED !== 'enabled') return {};
  try {
    const parsed = JSON.parse(env.REAL_MONEY_JURISDICTIONS_JSON ?? '{}') as Record<string, unknown>;
    const policies: Record<string, JurisdictionPolicy> = {};
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      const key = normalizeCode(rawKey);
      if (!key || !rawValue || typeof rawValue !== 'object') continue;
      const value = rawValue as Record<string, unknown>;
      const provider = value.provider === 'nuvei' || value.provider === 'approved_provider' ? value.provider : null;
      const minAge = Math.floor(Number(value.minAge));
      const legalReviewId = String(value.legalReviewId ?? '').trim().slice(0, 120);
      const providerApprovalId = String(value.providerApprovalId ?? '').trim().slice(0, 120);
      const reviewedAt = String(value.reviewedAt ?? '').trim().slice(0, 40);
      if (!provider || !Number.isFinite(minAge) || minAge < 18 || minAge > 25 || !legalReviewId || !providerApprovalId || !reviewedAt) continue;
      policies[key] = {
        enabled: value.enabled === true,
        minAge,
        provider,
        deposits: value.deposits === true,
        friendMatches: value.friendMatches === true,
        tournamentEntries: value.tournamentEntries === true,
        tournamentPrizes: value.tournamentPrizes === true,
        withdrawals: value.withdrawals === true,
        taxProfileRequired: value.taxProfileRequired !== false,
        legalReviewId,
        providerApprovalId,
        reviewedAt,
        expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt.slice(0, 40) : undefined,
      };
    }
    return policies;
  } catch {
    return {};
  }
}

function capabilityForPurpose(policy: JurisdictionPolicy, purpose: MoneyPurpose): boolean {
  if (purpose === 'premium_purchase' || purpose === 'refund') return true;
  if (purpose === 'wallet_deposit') return policy.deposits;
  if (purpose === 'friend_match_entry' || purpose === 'friend_match_prize' || purpose === 'color_bid' || purpose === 'position_bid') return policy.friendMatches;
  if (purpose === 'tournament_entry') return policy.tournamentEntries;
  if (purpose === 'tournament_prize') return policy.tournamentPrizes;
  if (purpose === 'withdrawal') return policy.withdrawals;
  return false;
}

export function decideRealMoneyAccess(
  env: PaymentPolicyEnv,
  profile: ComplianceProfile | null,
  purpose: MoneyPurpose,
  now = Date.now(),
): PolicyDecision {
  if (purpose === 'premium_purchase') return { allowed: true, jurisdiction: '', reason: null, policy: null };
  if (env.REAL_MONEY_ENABLED !== 'enabled') return { allowed: false, jurisdiction: '', reason: 'Real-money competition is disabled by operator policy.', policy: null };
  if (!profile) return { allowed: false, jurisdiction: '', reason: 'Identity and jurisdiction verification are required.', policy: null };
  const jurisdiction = jurisdictionKey(profile);
  const policy = parseJurisdictionPolicies(env)[jurisdiction] ?? null;
  if (!policy?.enabled) return { allowed: false, jurisdiction, reason: 'Real-money play is not approved in this jurisdiction.', policy };
  if (policy.expiresAt) {
    const expires = Date.parse(policy.expiresAt);
    if (!Number.isFinite(expires) || expires <= now) return { allowed: false, jurisdiction, reason: 'This jurisdiction approval requires legal re-review.', policy };
  }
  if (!profile.identityVerifiedAt || !profile.ageVerifiedAt || !profile.sanctionsCheckedAt) return { allowed: false, jurisdiction, reason: 'KYC, age and sanctions verification must be completed first.', policy };
  if (!Number.isFinite(profile.verifiedAge) || Number(profile.verifiedAge) < policy.minAge) return { allowed: false, jurisdiction, reason: `Players must be at least ${policy.minAge} in this jurisdiction.`, policy };
  if (policy.taxProfileRequired && (purpose === 'friend_match_prize' || purpose === 'tournament_prize' || purpose === 'withdrawal') && !profile.taxProfileVerifiedAt) {
    return { allowed: false, jurisdiction, reason: 'Tax profile verification is required before prizes or withdrawals.', policy };
  }
  if (!capabilityForPurpose(policy, purpose)) return { allowed: false, jurisdiction, reason: 'This real-money feature is not approved in this jurisdiction.', policy };
  return { allowed: true, jurisdiction, reason: null, policy };
}
