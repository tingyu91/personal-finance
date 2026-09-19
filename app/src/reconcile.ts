import type { ParsedStatement } from './adapters/types';

export interface Check {
  name: string;
  expected: number;
  actual: number;
  ok: boolean;
}

export interface ReconcileResult {
  ok: boolean;
  checks: Check[];
}

function check(name: string, expected: number, actual: number): Check {
  return { name, expected, actual, ok: expected === actual };
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

/**
 * Checks a parsed statement against its own printed figures, to the cent (PRD §4.2).
 * Deposit amounts add to the balance; card amounts are signed from the household's side,
 * so spending (negative) raises what is owed.
 */
export function reconcile(s: ParsedStatement): ReconcileResult {
  const checks: Check[] = [];
  const amounts = s.rows.map((r) => r.amountCents);

  if (s.account.kind === 'card') {
    checks.push(check('Opening plus charges less credits equals closing', s.closingCents, s.openingCents - sum(amounts)));
    if (s.printed.amountDueCents !== undefined) {
      checks.push(check('Closing matches the amount to pay', s.printed.amountDueCents, s.closingCents));
    }
    for (const sub of s.printed.subtotals ?? []) {
      const rows = sub.rowIdx.map((i) => s.rows[i]!.amountCents);
      checks.push(check(`Subtotal for ${sub.label}`, sub.cents, sub.openingCents - sum(rows)));
    }
    // Without the statement's own total there is nothing to reconcile against.
    checks.push(check('Printed total balance found', 1, s.printed.closingCents === undefined ? 0 : 1));
  } else {
    if (s.printed.debitsCents !== undefined) {
      checks.push(check('Withdrawals match the printed total', s.printed.debitsCents, -sum(amounts.filter((a) => a < 0))));
    }
    if (s.printed.creditsCents !== undefined) {
      checks.push(check('Deposits match the printed total', s.printed.creditsCents, sum(amounts.filter((a) => a > 0))));
    }
    checks.push(check('Opening plus rows equals closing', s.closingCents, s.openingCents + sum(amounts)));
    if (s.printed.closingCents !== undefined) {
      checks.push(check('Closing matches the printed closing', s.printed.closingCents, s.closingCents));
    }
    const running: number[] = [];
    let bal = s.openingCents;
    for (const a of amounts) running.push((bal += a));
    const points = [
      ...s.rows.flatMap((r, i) => (r.balanceCents === undefined ? [] : [{ i, cents: r.balanceCents }])),
      ...(s.checkpoints ?? []).map((c) => ({ i: c.afterRow, cents: c.balanceCents })),
    ];
    if (points.length) {
      const at = (i: number) => (i < 0 ? s.openingCents : running[i]!);
      const bad = points.find((p) => at(p.i) !== p.cents);
      checks.push(bad ? check('Running balances match', bad.cents, at(bad.i)) : check('Running balances match', 0, 0));
    }
    checks.push(check('Printed closing balance found', 1, s.printed.closingCents === undefined ? 0 : 1));
  }
  return { ok: checks.every((c) => c.ok), checks };
}
