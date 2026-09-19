/**
 * Schema migrations, applied in order; PRAGMA user_version records how many ran.
 * Append new migrations; never edit one that has shipped.
 */
export const MIGRATIONS: string[] = [
  // 1 — import: accounts, files, statements, transactions (PRD §7.2)
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    -- kind:last4:currency, stable across imports. The bank is left out on purpose: a card first
    -- seen only as a repayment target ("CCC - ·1234") has no known issuer, and must become the
    -- same account when its own statements arrive. Two issuers' cards sharing a last four would
    -- merge; accepted as very unlikely for one household.
    key TEXT NOT NULL UNIQUE,
    bank TEXT NOT NULL,
    product TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('deposit', 'card', 'wallet', 'loan', 'investment')),
    last4 TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'SGD',
    owner TEXT NOT NULL DEFAULT 'me' CHECK (owner IN ('me', 'joint', 'partner')),
    seen_only_as_target INTEGER NOT NULL DEFAULT 0,
    label TEXT
  );

  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    vault_path TEXT NOT NULL,                 -- relative to the data folder
    adapter_id TEXT NOT NULL,
    adapter_version INTEGER NOT NULL,
    month TEXT NOT NULL,
    imported_at TEXT NOT NULL
  );

  CREATE TABLE statements (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    month TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    opening_cents INTEGER NOT NULL,
    closing_cents INTEGER NOT NULL,
    printed_json TEXT NOT NULL,
    checks_json TEXT NOT NULL,
    reconciled INTEGER NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0,      -- Ting Yu resolved a failed reconciliation
    rows_skipped INTEGER NOT NULL DEFAULT 0,  -- rows already stored from an overlapping statement
    meta_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (account_id, month)                -- one statement per account per month
  );

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    statement_id INTEGER REFERENCES statements(id) ON DELETE CASCADE,   -- null for manual entries
    account_id INTEGER REFERENCES accounts(id),                         -- null for cash
    seq INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    post_date TEXT,
    raw TEXT NOT NULL,                        -- redacted statement text, lines joined by " · "
    payee TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,            -- signed: negative is money out, in the row's currency
    currency TEXT NOT NULL DEFAULT 'SGD',     -- the account's currency; totals only ever sum SGD
    balance_cents INTEGER,
    fx_currency TEXT,
    fx_amount_cents INTEGER,
    cardholder TEXT,
    card_last4 TEXT,
    fingerprint TEXT NOT NULL UNIQUE,
    manual INTEGER NOT NULL DEFAULT 0,
    kind TEXT,
    category TEXT,
    bucket TEXT,
    vendor TEXT,
    pair_fingerprint TEXT,
    target_account_id INTEGER REFERENCES accounts(id),
    needs_review INTEGER NOT NULL DEFAULT 0,
    classified_by TEXT,
    note TEXT
  );
  CREATE INDEX transactions_account_date ON transactions (account_id, date);
  CREATE INDEX transactions_date ON transactions (date);
  CREATE INDEX transactions_kind ON transactions (kind);
  `,
];
