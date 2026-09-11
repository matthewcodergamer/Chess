export const BASIS_POINTS_SCALE = 10_000;
export const USD_CENTS_PER_DOLLAR = 100;

function integerValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function positiveCents(value: unknown, maxCents = Number.MAX_SAFE_INTEGER): number {
  const amount = integerValue(value);
  return amount !== null && amount > 0 && amount <= maxCents ? amount : 0;
}

export function nonNegativeCents(value: unknown, maxCents = Number.MAX_SAFE_INTEGER): number | null {
  const amount = integerValue(value);
  return amount !== null && amount >= 0 && amount <= maxCents ? amount : null;
}

export function signedCents(value: unknown, maxAbsoluteCents = Number.MAX_SAFE_INTEGER): number | null {
  const amount = integerValue(value);
  return amount !== null && Math.abs(amount) <= maxAbsoluteCents ? amount : null;
}

export function basisPointsAmount(amountCents: number, basisPoints: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error('Money amount must be non-negative integer cents.');
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > BASIS_POINTS_SCALE) throw new Error('Basis points are out of range.');
  return Number((BigInt(amountCents) * BigInt(basisPoints)) / BigInt(BASIS_POINTS_SCALE));
}

export function usdDecimalToCents(value: unknown, maxCents = Number.MAX_SAFE_INTEGER): number | null {
  const text = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const dollars = Number(match[1]);
  if (!Number.isSafeInteger(dollars)) return null;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const cents = dollars * USD_CENTS_PER_DOLLAR + Number(fraction || '0');
  return Number.isSafeInteger(cents) && cents <= maxCents ? cents : null;
}

export function centsToUsdDecimal(amountCents: number): string {
  if (!Number.isSafeInteger(amountCents)) throw new Error('Money amount must be integer cents.');
  const negative = amountCents < 0;
  const absolute = Math.abs(amountCents);
  const dollars = Math.floor(absolute / USD_CENTS_PER_DOLLAR);
  const cents = absolute % USD_CENTS_PER_DOLLAR;
  return `${negative ? '-' : ''}${dollars}.${String(cents).padStart(2, '0')}`;
}

export function formatUsdCents(amountCents: number): string {
  if (!Number.isSafeInteger(amountCents)) return '$0.00';
  const negative = amountCents < 0;
  const absolute = Math.abs(amountCents);
  const dollars = Math.floor(absolute / USD_CENTS_PER_DOLLAR).toLocaleString('en-US');
  const cents = absolute % USD_CENTS_PER_DOLLAR;
  return `${negative ? '-' : ''}$${dollars}.${String(cents).padStart(2, '0')}`;
}

export function formatBasisPoints(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints)) return '0%';
  const whole = Math.floor(Math.abs(basisPoints) / 100);
  const fraction = Math.abs(basisPoints) % 100;
  const suffix = fraction ? `.${String(fraction).padStart(2, '0').replace(/0+$/, '')}` : '';
  return `${basisPoints < 0 ? '-' : ''}${whole}${suffix}%`;
}
