export type Glicko2Rating = {
  rating: number;
  deviation: number;
  volatility: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  provisional: boolean;
  lastRatedAt: number | null;
};

const GLICKO2_SCALE = 173.7178;
const DEFAULT_RATING = 1500;
const DEFAULT_DEVIATION = 350;
const DEFAULT_VOLATILITY = 0.06;
const TAU = 0.5;
const EPSILON = 0.000001;
const RATING_PERIOD_MS = 24 * 60 * 60 * 1000;
const MAX_DEVIATION = 350;
const MIN_DEVIATION = 30;
const PROVISIONAL_GAMES = 10;
const PROVISIONAL_DEVIATION = 110;

function finite(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function isProvisionalRating(games: number, deviation: number): boolean {
  return Math.max(0, Math.floor(finite(games, 0))) < PROVISIONAL_GAMES || finite(deviation, MAX_DEVIATION) > PROVISIONAL_DEVIATION;
}

export function createGlicko2Rating(seedRating = DEFAULT_RATING): Glicko2Rating {
  const rating = clamp(finite(seedRating, DEFAULT_RATING), 100, 4000);
  return {
    rating,
    deviation: DEFAULT_DEVIATION,
    volatility: DEFAULT_VOLATILITY,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    provisional: true,
    lastRatedAt: null,
  };
}

export function normalizeGlicko2Rating(value: Partial<Glicko2Rating> | null | undefined, seedRating = DEFAULT_RATING): Glicko2Rating {
  const games = Math.max(0, Math.floor(finite(value?.games, 0)));
  const deviation = clamp(finite(value?.deviation, DEFAULT_DEVIATION), MIN_DEVIATION, MAX_DEVIATION);
  return {
    rating: clamp(finite(value?.rating, seedRating), 100, 4000),
    deviation,
    volatility: clamp(finite(value?.volatility, DEFAULT_VOLATILITY), 0.01, 0.5),
    games,
    wins: Math.max(0, Math.floor(finite(value?.wins, 0))),
    draws: Math.max(0, Math.floor(finite(value?.draws, 0))),
    losses: Math.max(0, Math.floor(finite(value?.losses, 0))),
    provisional: isProvisionalRating(games, deviation),
    lastRatedAt: typeof value?.lastRatedAt === 'number' && Number.isFinite(value.lastRatedAt) ? value.lastRatedAt : null,
  };
}

function toMu(rating: number): number {
  return (rating - DEFAULT_RATING) / GLICKO2_SCALE;
}

function toPhi(deviation: number): number {
  return deviation / GLICKO2_SCALE;
}

function fromMu(mu: number): number {
  return mu * GLICKO2_SCALE + DEFAULT_RATING;
}

function fromPhi(phi: number): number {
  return phi * GLICKO2_SCALE;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expected(mu: number, opponentMu: number, opponentPhi: number): number {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

function inactivityAdjusted(state: Glicko2Rating, at: number): Glicko2Rating {
  if (!state.lastRatedAt || at <= state.lastRatedAt) return state;
  const periods = Math.min(3650, Math.floor((at - state.lastRatedAt) / RATING_PERIOD_MS));
  if (periods <= 0) return state;
  const phi = toPhi(state.deviation);
  const expandedPhi = Math.sqrt(phi * phi + periods * state.volatility * state.volatility);
  const deviation = clamp(fromPhi(expandedPhi), MIN_DEVIATION, MAX_DEVIATION);
  return { ...state, deviation, provisional: isProvisionalRating(state.games, deviation) };
}

function nextVolatility(phi: number, sigma: number, variance: number, delta: number): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const numerator = ex * (delta * delta - phi * phi - variance - ex);
    const denominator = 2 * (phi * phi + variance + ex) ** 2;
    return numerator / denominator - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + variance) {
    B = Math.log(delta * delta - phi * phi - variance);
  } else {
    let k = 1;
    B = a - k * TAU;
    while (f(B) < 0 && k < 100) {
      k += 1;
      B = a - k * TAU;
    }
  }

  let fA = f(A);
  let fB = f(B);
  let iterations = 0;
  while (Math.abs(B - A) > EPSILON && iterations < 100) {
    const denominator = fB - fA;
    if (Math.abs(denominator) < Number.EPSILON) break;
    const C = A + ((A - B) * fA) / denominator;
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
    iterations += 1;
  }

  return clamp(Math.exp(A / 2), 0.01, 0.5);
}

/**
 * Rates one completed game as one Glicko-2 rating period. Before the game,
 * rating deviation expands for elapsed 24-hour periods without rated play.
 * The opponent passed here must be the pre-game state, so both players are
 * always updated from the same snapshot.
 */
export function rateGlicko2(playerValue: Glicko2Rating, opponentValue: Glicko2Rating, scoreValue: number, at = Date.now()): Glicko2Rating {
  const player = inactivityAdjusted(normalizeGlicko2Rating(playerValue), at);
  const opponent = inactivityAdjusted(normalizeGlicko2Rating(opponentValue), at);
  const score = scoreValue >= 1 ? 1 : scoreValue <= 0 ? 0 : 0.5;

  const mu = toMu(player.rating);
  const phi = toPhi(player.deviation);
  const opponentMu = toMu(opponent.rating);
  const opponentPhi = toPhi(opponent.deviation);
  const impact = g(opponentPhi);
  const expectation = expected(mu, opponentMu, opponentPhi);
  const variance = 1 / (impact * impact * expectation * (1 - expectation));
  const delta = variance * impact * (score - expectation);
  const sigmaPrime = nextVolatility(phi, player.volatility, variance, delta);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / variance);
  const muPrime = mu + phiPrime * phiPrime * impact * (score - expectation);

  const games = player.games + 1;
  const deviation = clamp(fromPhi(phiPrime), MIN_DEVIATION, MAX_DEVIATION);
  return {
    rating: rounded(clamp(fromMu(muPrime), 100, 4000)),
    deviation: rounded(deviation),
    volatility: rounded(sigmaPrime, 6),
    games,
    wins: player.wins + (score === 1 ? 1 : 0),
    draws: player.draws + (score === 0.5 ? 1 : 0),
    losses: player.losses + (score === 0 ? 1 : 0),
    provisional: isProvisionalRating(games, deviation),
    lastRatedAt: at,
  };
}
