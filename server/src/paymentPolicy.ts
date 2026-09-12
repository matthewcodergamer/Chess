import { basisPointsAmount } from '../../shared/money';

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
  | 'withdrawal'
  | 'adjustment';

export type CompetitionProvider = 'nuvei' | 'approved_provider';
export type PaymentFeePolicyId = 'friend_match_v1' | 'tournament_v1';
export type FinancialVerificationTier = 'none' | 'funding' | 'competition' | 'payout';
export type ComplianceRequirement =
  | 'jurisdiction'
  | 'age'
  | 'identity'
  | 'legal_name'
  | 'date_of_birth'
  | 'sanctions'
  | 'tax_profile'
  | 'payout_method';

export type PaymentFeePolicy = {
  id: PaymentFeePolicyId;
  platformFeeBps: number;
  currency: 'USD';
  description: string;
};

export const PAYMENT_FEE_POLICY_TABLE: Readonly<Record<PaymentFeePolicyId, Readonly<PaymentFeePolicy>>> = Object.freeze({
  friend_match_v1: Object.freeze({
    id: 'friend_match_v1',
    platformFeeBps: 2_000,
    currency: 'USD',
    description: 'QQURZ friend-match platform fee: 20% of the funded pot.',
  }),
  tournament_v1: Object.freeze({
    id: 'tournament_v1',
    platformFeeBps: 2_000,
    currency: 'USD',
    description: 'QQURZ tournament platform fee: 20% of the funded entry pot before prize shares.',
  }),
});

export function feePolicyForPurpose(purpose: 'friend_match_prize' | 'tournament_prize'): Readonly<PaymentFeePolicy> {
  return purpose === 'tournament_prize' ? PAYMENT_FEE_POLICY_TABLE.tournament_v1 : PAYMENT_FEE_POLICY_TABLE.friend_match_v1;
}

export function platformFeeCents(potCents: number, policy: Pick<PaymentFeePolicy, 'platformFeeBps'>): number {
  return basisPointsAmount(potCents, policy.platformFeeBps);
}

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
  fundingRequirements: ComplianceRequirement[];
  competitionRequirements: ComplianceRequirement[];
  payoutRequirements: ComplianceRequirement[];
  legalReviewId: string;
  providerApprovalId: string;
  reviewedAt: string;
  expiresAt?: string;
};

/**
 * Financial verification is deliberately separate from the ordinary chess account.
 * Raw legal name / DOB should remain with the approved KYC provider whenever possible;
 * QQURZ stores only provider attestations and references needed to authorize money actions.
 */
export type ComplianceProfile = {
  accountId: string;
  identityVerifiedAt: number | null;
  legalNameVerifiedAt?: number | null;
  dateOfBirthVerifiedAt?: number | null;
  ageVerifiedAt: number | null;
  verifiedAge: number | null;
  jurisdictionVerifiedAt?: number | null;
  countryCode: string;
  regionCode: string;
  taxProfileVerifiedAt: number | null;
  sanctionsCheckedAt: number | null;
  payoutMethodVerifiedAt?: number | null;
  providerCustomerId: string | null;
  verificationProvider?: string | null;
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
  verificationTier: FinancialVerificationTier;
  requiredChecks: ComplianceRequirement[];
  missingChecks: ComplianceRequirement[];
};

const VALID_REQUIREMENTS = new Set<ComplianceRequirement>([
  'jurisdiction',
  'age',
  'identity',
  'legal_name',
  'date_of_birth',
  'sanctions',
  'tax_profile',
  'payout_method',
]);

const DEFAULT_FUNDING_REQUIREMENTS: ComplianceRequirement[] = ['jurisdiction', 'age'];
const DEFAULT_COMPETITION_REQUIREMENTS: ComplianceRequirement[] = ['jurisdiction', 'age', 'identity', 'sanctions'];
const DEFAULT_PAYOUT_REQUIREMENTS: ComplianceRequirement[] = ['jurisdiction', 'age', 'identity', 'legal_name', 'date_of_birth', 'sanctions', 'payout_method'];

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
}

function normalizedRequirements(value: unknown, fallback: ComplianceRequirement[]): ComplianceRequirement[] {
  if (!Array.isArray(value)) return [...fallback];
  const output = value
    .map(item => String(item).trim() as ComplianceRequirement)
    .filter((item): item is ComplianceRequirement => VALID_REQUIREMENTS.has(item));
  return [...new Set(output)];
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
      const taxProfileRequired = value.taxProfileRequired !== false;
      const payoutRequirements = normalizedRequirements(value.payoutRequirements, DEFAULT_PAYOUT_REQUIREMENTS);
      if (taxProfileRequired && !payoutRequirements.includes('tax_profile')) payoutRequirements.push('tax_profile');
      policies[key] = {
        enabled: value.enabled === true,
        minAge,
        provider,
        deposits: value.deposits === true,
        friendMatches: value.friendMatches === true,
        tournamentEntries: value.tournamentEntries === true,
        tournamentPrizes: value.tournamentPrizes === true,
        withdrawals: value.withdrawals === true,
        taxProfileRequired,
        fundingRequirements: normalizedRequirements(value.fundingRequirements, DEFAULT_FUNDING_REQUIREMENTS),
        competitionRequirements: normalizedRequirements(value.competitionRequirements, DEFAULT_COMPETITION_REQUIREMENTS),
        payoutRequirements,
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
  if (purpose === 'premium_purchase' || purpose === 'refund' || purpose === 'adjustment') return true;
  if (purpose === 'wallet_deposit') return policy.deposits;
  if (purpose === 'friend_match_entry' || purpose === 'friend_match_prize' || purpose === 'color_bid' || purpose === 'position_bid') return policy.friendMatches;
  if (purpose === 'tournament_entry') return policy.tournamentEntries;
  if (purpose === 'tournament_prize') return policy.tournamentPrizes;
  if (purpose === 'withdrawal') return policy.withdrawals;
  return false;
}

export function verificationTierForPurpose(purpose: MoneyPurpose): FinancialVerificationTier {
  if (purpose === 'premium_purchase' || purpose === 'refund' || purpose === 'adjustment') return 'none';
  if (purpose === 'wallet_deposit') return 'funding';
  if (purpose === 'friend_match_entry' || purpose === 'tournament_entry' || purpose === 'color_bid' || purpose === 'position_bid') return 'competition';
  return 'payout';
}

export function requirementsForPurpose(policy: JurisdictionPolicy, purpose: MoneyPurpose): ComplianceRequirement[] {
  const tier = verificationTierForPurpose(purpose);
  if (tier === 'none') return [];
  if (tier === 'funding') return [...policy.fundingRequirements];
  if (tier === 'competition') return [...policy.competitionRequirements];
  return [...policy.payoutRequirements];
}

export function missingComplianceRequirements(
  profile: ComplianceProfile,
  policy: JurisdictionPolicy,
  purpose: MoneyPurpose,
): ComplianceRequirement[] {
  const required = requirementsForPurpose(policy, purpose);
  return required.filter(requirement => {
    // Signed compliance profiles are payment-provider records, not self-asserted account fields.
    if (requirement === 'jurisdiction') return !(profile.jurisdictionVerifiedAt || profile.countryCode);
    if (requirement === 'age') return !profile.ageVerifiedAt || !Number.isFinite(profile.verifiedAge) || Number(profile.verifiedAge) < policy.minAge;
    if (requirement === 'identity') return !profile.identityVerifiedAt;
    // A provider's identity assertion may already encompass legal-name verification.
    if (requirement === 'legal_name') return !(profile.legalNameVerifiedAt || profile.identityVerifiedAt);
    // A provider's verified-age assertion may be derived from verified DOB without QQURZ retaining raw DOB.
    if (requirement === 'date_of_birth') return !(profile.dateOfBirthVerifiedAt || profile.ageVerifiedAt);
    if (requirement === 'sanctions') return !profile.sanctionsCheckedAt;
    if (requirement === 'tax_profile') return !profile.taxProfileVerifiedAt;
    // A provider customer/payment reference is enough when the provider owns payout-method KYC.
    if (requirement === 'payout_method') return !(profile.payoutMethodVerifiedAt || profile.providerCustomerId);
    return true;
  });
}

function fallbackRequirementsForPurpose(purpose: MoneyPurpose): ComplianceRequirement[] {
  const tier = verificationTierForPurpose(purpose);
  if (tier === 'none') return [];
  if (tier === 'funding') return [...DEFAULT_FUNDING_REQUIREMENTS];
  if (tier === 'competition') return [...DEFAULT_COMPETITION_REQUIREMENTS];
  return [...DEFAULT_PAYOUT_REQUIREMENTS, 'tax_profile'];
}

export function decideRealMoneyAccess(
  env: PaymentPolicyEnv,
  profile: ComplianceProfile | null,
  purpose: MoneyPurpose,
  now = Date.now(),
): PolicyDecision {
  const verificationTier = verificationTierForPurpose(purpose);
  if (verificationTier === 'none') return { allowed: true, jurisdiction: '', reason: null, policy: null, verificationTier, requiredChecks: [], missingChecks: [] };
  const fallbackRequirements = fallbackRequirementsForPurpose(purpose);
  if (env.REAL_MONEY_ENABLED !== 'enabled') return {
    allowed: false,
    jurisdiction: '',
    reason: 'Real-money competition is disabled by operator policy.',
    policy: null,
    verificationTier,
    requiredChecks: fallbackRequirements,
    missingChecks: fallbackRequirements,
  };
  if (!profile) return {
    allowed: false,
    jurisdiction: '',
    reason: 'Financial verification is required only for this money feature. Free chess does not require KYC.',
    policy: null,
    verificationTier,
    requiredChecks: fallbackRequirements,
    missingChecks: fallbackRequirements,
  };
  const jurisdiction = jurisdictionKey(profile);
  const policy = parseJurisdictionPolicies(env)[jurisdiction] ?? null;
  if (!policy?.enabled) return {
    allowed: false,
    jurisdiction,
    reason: 'Real-money play is not approved in this jurisdiction.',
    policy,
    verificationTier,
    requiredChecks: fallbackRequirements,
    missingChecks: fallbackRequirements,
  };
  const requiredChecks = requirementsForPurpose(policy, purpose);
  if (policy.expiresAt) {
    const expires = Date.parse(policy.expiresAt);
    if (!Number.isFinite(expires) || expires <= now) return {
      allowed: false,
      jurisdiction,
      reason: 'This jurisdiction approval requires legal re-review.',
      policy,
      verificationTier,
      requiredChecks,
      missingChecks: requiredChecks,
    };
  }
  if (!capabilityForPurpose(policy, purpose)) return {
    allowed: false,
    jurisdiction,
    reason: 'This real-money feature is not approved in this jurisdiction.',
    policy,
    verificationTier,
    requiredChecks,
    missingChecks: [],
  };
  const missingChecks = missingComplianceRequirements(profile, policy, purpose);
  if (missingChecks.length) return {
    allowed: false,
    jurisdiction,
    reason: `Complete ${verificationTier} verification before using this money feature.`,
    policy,
    verificationTier,
    requiredChecks,
    missingChecks,
  };
  return { allowed: true, jurisdiction, reason: null, policy, verificationTier, requiredChecks, missingChecks: [] };
}
