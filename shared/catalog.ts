export type CheckoutKind = 'tournament' | 'premium3d' | 'position_bid' | 'color_bid' | 'subscription' | 'theme' | 'blitz';

export type CatalogItemId =
  | '3d-pass'
  | 'theme-green'
  | 'theme-slate'
  | 'pieces-warm'
  | 'blitz-day'
  | 'blitz-month'
  | 'sub-monthly'
  | 'sub-quarterly'
  | 'sub-six'
  | 'sub-annual';

export type RecurringInterval = {
  interval: 'month' | 'year';
  intervalCount: number;
};

export type CatalogItem = {
  id: CatalogItemId;
  kind: CheckoutKind;
  name: string;
  cents: number;
  blurb: string;
  recurring?: RecurringInterval;
};

export const FREE_HUMAN_MATCHES_PER_MONTH = 10;

export const CATALOG: Record<CatalogItemId, CatalogItem> = {
  '3d-pass': { id: '3d-pass', kind: 'premium3d', name: '3D board skin', cents: 399, blurb: 'Table-style 3D board and clock. One-time unlock.' },
  'theme-green': { id: 'theme-green', kind: 'theme', name: 'Tournament green board', cents: 199, blurb: 'The green tournament board. One-time theme.' },
  'theme-slate': { id: 'theme-slate', kind: 'theme', name: 'Slate board', cents: 199, blurb: 'Cool gray board. One-time theme.' },
  'pieces-warm': { id: 'pieces-warm', kind: 'theme', name: 'Warm wood pieces', cents: 199, blurb: 'Paid piece colors on the same cburnett set.' },
  'blitz-day': { id: 'blitz-day', kind: 'blitz', name: 'Blitz day pass', cents: 199, blurb: 'One day of blitz and bullet for free-tier players.' },
  'blitz-month': { id: 'blitz-month', kind: 'blitz', name: 'Blitz month pass', cents: 999, blurb: 'Unlimited fast games for a month.', recurring: { interval: 'month', intervalCount: 1 } },
  'sub-monthly': { id: 'sub-monthly', kind: 'subscription', name: 'Freestyle monthly', cents: 999, blurb: 'Unlimited human matches, rated play, and every extra.', recurring: { interval: 'month', intervalCount: 1 } },
  'sub-quarterly': { id: 'sub-quarterly', kind: 'subscription', name: 'Freestyle quarterly', cents: 2850, blurb: 'Three months of Freestyle.', recurring: { interval: 'month', intervalCount: 3 } },
  'sub-six': { id: 'sub-six', kind: 'subscription', name: 'Freestyle six months', cents: 5400, blurb: 'Six months of Freestyle.', recurring: { interval: 'month', intervalCount: 6 } },
  'sub-annual': { id: 'sub-annual', kind: 'subscription', name: 'Freestyle annual', cents: 9600, blurb: 'Twenty percent off — two months free.', recurring: { interval: 'year', intervalCount: 1 } },
};

export const SUBSCRIPTION_IDS: CatalogItemId[] = ['sub-monthly', 'sub-quarterly', 'sub-six', 'sub-annual'];
export const THEME_IDS: CatalogItemId[] = ['theme-green', 'theme-slate', 'pieces-warm'];

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function catalogItem(id: string): CatalogItem | null {
  return id in CATALOG ? CATALOG[id as CatalogItemId] : null;
}

export function isCatalogCheckoutKind(value: string | null | undefined): value is CheckoutKind {
  return value === 'premium3d' || value === 'subscription' || value === 'theme' || value === 'blitz'
    || value === 'tournament' || value === 'position_bid' || value === 'color_bid';
}
