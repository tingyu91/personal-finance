import type { Db } from '../db/open';
import type { Settings } from '../settings';
import type { AccountKind, Owner } from '../adapters/types';
import type { Kind } from './categories';
import { classify, type ClassifyAccount, type ClassifyRow, type DecisionRow, type RuleRow } from './pipeline';

/** Loads everything, classifies, and writes the results back in one transaction. */
export function classifyAll(db: Db, settings: Settings): { rows: number; newAccounts: number } {
  const accounts: ClassifyAccount[] = (
    db.prepare('SELECT id, key, bank, kind, last4, owner, seen_only_as_target FROM accounts').all() as {
      id: number;
      key: string;
      bank: string;
      kind: AccountKind;
      last4: string;
      owner: Owner;
      seen_only_as_target: number;
    }[]
  ).map((a) => ({ id: a.id, key: a.key, bank: a.bank, kind: a.kind, last4: a.last4, owner: a.owner, seenOnly: a.seen_only_as_target === 1 }));

  const rows: ClassifyRow[] = (
    db
      .prepare(
        `SELECT t.id, t.fingerprint, t.account_id, t.date, t.amount_cents, t.currency, t.raw, t.manual,
                CASE WHEN s.id IS NULL THEN 0 ELSE (s.reconciled = 0 AND s.accepted = 0) END held
         FROM transactions t LEFT JOIN statements s ON s.id = t.statement_id ORDER BY t.date, t.id`,
      )
      .all() as {
      id: number;
      fingerprint: string;
      account_id: number | null;
      date: string;
      amount_cents: number;
      currency: string;
      raw: string;
      manual: number;
      held: number;
    }[]
  ).map((r) => ({
    id: r.id,
    fingerprint: r.fingerprint,
    accountId: r.account_id,
    date: r.date,
    amountCents: r.amount_cents,
    currency: r.currency,
    raw: r.raw,
    manual: r.manual === 1,
    held: r.held === 1,
  }));

  const rules: RuleRow[] = (
    db.prepare("SELECT * FROM rules WHERE source = 'user'").all() as {
      id: number;
      source: 'seed' | 'user';
      priority: number;
      field: 'payee' | 'raw';
      pattern: string;
      is_regex: number;
      sign: 'in' | 'out' | null;
      account_id: number | null;
      set_kind: Kind | null;
      set_category: string | null;
      set_bucket: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    source: r.source,
    priority: r.priority,
    field: r.field,
    pattern: r.pattern,
    isRegex: r.is_regex === 1,
    sign: r.sign,
    accountId: r.account_id,
    setKind: r.set_kind,
    setCategory: r.set_category,
    setBucket: r.set_bucket,
  }));

  const decisions = db.prepare('SELECT fingerprint, kind, category, bucket, vendor, note FROM decisions').all() as DecisionRow[];

  // Supplementary cards print their own numbers; a bill naming one belongs to the main card.
  const cardAliases = db
    .prepare(
      `SELECT DISTINCT t.card_last4 AS last4, t.account_id AS accountId FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE a.kind = 'card' AND t.card_last4 IS NOT NULL AND t.card_last4 <> a.last4`,
    )
    .all() as { last4: string; accountId: number }[];

  const { results, newAccounts, accountUpdates } = classify({ rows, accounts, settings, rules, decisions, cardAliases });

  db.transaction(() => {
    const keyToId = new Map<string, number>();
    for (const na of newAccounts) {
      const existing = db.prepare('SELECT id FROM accounts WHERE key = ?').get(na.key) as { id: number } | undefined;
      if (existing) keyToId.set(na.key, existing.id);
      else {
        const r = db
          .prepare("INSERT INTO accounts (key, bank, product, kind, last4, currency, owner, seen_only_as_target) VALUES (?, ?, ?, 'card', ?, 'SGD', 'me', 1)")
          .run(na.key, na.bank, na.product, na.last4);
        keyToId.set(na.key, Number(r.lastInsertRowid));
      }
    }
    for (const u of accountUpdates) db.prepare("UPDATE accounts SET bank = ? WHERE id = ? AND bank = ''").run(u.bank, u.id);

    const update = db.prepare(
      // A manual entry keeps the payee you typed; statement rows get the cleaned payee.
      `UPDATE transactions SET payee = CASE WHEN manual = 1 THEN payee ELSE ? END, kind = ?, category = ?, bucket = ?, vendor = ?, note = ?,
       pair_fingerprint = ?, target_account_id = ?, needs_review = ?, classified_by = ? WHERE id = ?`,
    );
    for (const r of results) {
      const target = r.target?.accountId ?? (r.target?.newKey ? keyToId.get(r.target.newKey) ?? null : null);
      update.run(r.payee, r.kind, r.category, r.bucket, r.vendor, r.note, r.pairFingerprint, target, r.needsReview ? 1 : 0, r.classifiedBy, r.id);
    }

    // A card known only as a repayment target disappears once nothing points to it.
    db.prepare(
      `DELETE FROM accounts WHERE seen_only_as_target = 1
       AND id NOT IN (SELECT target_account_id FROM transactions WHERE target_account_id IS NOT NULL)
       AND id NOT IN (SELECT account_id FROM transactions WHERE account_id IS NOT NULL)
       AND id NOT IN (SELECT account_id FROM statements)
       AND id NOT IN (SELECT account_id FROM rules WHERE account_id IS NOT NULL)`,
    ).run();
  })();
  return { rows: results.length, newAccounts: newAccounts.length };
}
