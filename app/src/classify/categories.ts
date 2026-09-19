/**
 * Spending categories keep their chart slot for life (design system): colour follows the
 * category, never its rank. A ninth category folds into Other (slot 0).
 */
export const CATEGORIES = [
  { slot: 1, name: 'Food & groceries' },
  { slot: 2, name: 'Transport' },
  { slot: 3, name: 'Home running' },
  { slot: 4, name: 'Home project' },
  { slot: 5, name: 'Health & personal care' },
  { slot: 6, name: 'Shopping & subscriptions' },
  { slot: 7, name: 'Travel & leisure' },
  { slot: 8, name: 'Family & giving' },
  { slot: 0, name: 'Other' },
] as const;

export type SpendingCategory = (typeof CATEGORIES)[number]['name'];

export const INCOME_CATEGORIES = ['Salary', 'Interest', 'Other income'] as const;

/** Home project buckets (PRD §5): what the money bought. */
export const BUCKETS = ['purchase', 'renovation', 'furnishing', 'running'] as const;
export type Bucket = (typeof BUCKETS)[number];

export const KINDS = [
  'spend',
  'income',
  'transfer',
  'card-repayment',
  'investment',
  'wallet-topup',
  'refund',
  'fee',
  'tax',
  'partner-contribution',
  'unclassified',
] as const;

export type Kind = (typeof KINDS)[number];

/** Only these count as spending (PRD §7.2). Only `income` counts as income. */
export const SPENDING_KINDS: readonly Kind[] = ['spend', 'fee', 'tax'];

export const NON_SPEND_KINDS: readonly Kind[] = ['transfer', 'card-repayment', 'investment', 'wallet-topup', 'refund', 'partner-contribution'];

export function slotOf(category: string | null | undefined): number {
  return CATEGORIES.find((c) => c.name === category)?.slot ?? 0;
}

export function isKind(s: unknown): s is Kind {
  return typeof s === 'string' && (KINDS as readonly string[]).includes(s);
}

/** A spending category means the row is spending; an income category means income. */
export function kindForCategory(category: string | null | undefined): Kind | null {
  if (!category) return null;
  if (CATEGORIES.some((c) => c.name === category)) return 'spend';
  if ((INCOME_CATEGORIES as readonly string[]).includes(category)) return 'income';
  return null;
}

export function isCategory(s: unknown): boolean {
  return typeof s === 'string' && (CATEGORIES.some((c) => c.name === s) || (INCOME_CATEGORIES as readonly string[]).includes(s));
}
