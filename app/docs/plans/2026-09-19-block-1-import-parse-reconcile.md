# Block 1 — Import, parse, reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sample PDF imports from a drop, the inbox or the CLI; every statement reconciles to its printed totals and balances to the cent; re-importing changes nothing; no identifier is ever stored.

**Architecture:** `pdf/extract.ts` turns a PDF into pages of text lines (items keep x, width and right edge). One adapter per layout turns those lines into `ParsedStatement[]` (one per account section). `reconcile.ts` checks each statement against its own printed figures. `import/importer.ts` hashes the file, detects the adapter, parses, reconciles, redacts, fingerprints, writes the vault copy and inserts everything in one SQLite transaction, then returns a receipt.

**Tech Stack:** pdfjs-dist 4.10 (legacy build), better-sqlite3 11.10, Hono, Vitest.

**Spec:** `../../../prd/pending/prd-tally-personal-finance-2026-09-19.md` (§2 formats, §4 criteria 1–3 and 9, §5 Import/Parser/Reconciliation/Password/Vault, §6 Constraints, §7.2 Data model, §8 Block 1)

## Global Constraints

- Money is integer cents. A row's `amountCents` is signed from the household's side: negative is money out (a card purchase is negative, a card `CR` is positive).
- Dates are ISO `YYYY-MM-DD` (SGT, no time). Card rows keep `postDate` and `date` (transaction date). Reports use `date`.
- Redact at import: NRIC/FIN `[STFGM]\d{7}[A-Z]` becomes `[NRIC]`; any run of 8 or more digits (spaces or dashes allowed inside) becomes `·` + its last four; address blocks are never read (adapters only read the table regions and named header fields).
- A statement that does not reconcile is stored with `reconciled = 0`. Its rows stay out of every total until accepted.
- Fingerprint = SHA-1 of `accountKey | date | amountCents | normalised raw | cardLast4 | occurrence`, where normalised raw is upper-cased, digits and non-letters removed, and occurrence counts identical tuples within one statement.
- Tests that read real statements look in `TALLY_INBOX_DIR` (a `;`-separated list is allowed) or `inputs/statements/`, and skip when no PDF is found. No real statement, figure or identifier is committed. Synthetic fixtures use invented names and numbers.
- SQLite runs with `journal_mode = DELETE` (rollback journal) and `foreign_keys = ON`.

## Decisions settled for this block

| Question | Choice |
|---|---|
| One file, several accounts | `adapter.parse()` returns `ParsedStatement[]`. The UOB card PDF yields one statement per principal card; the DBS consolidated PDF yields one per currency (SGD and USD) |
| Card accounts | Keyed by the principal card's last four. Supplementary cardholders' rows stay in that account with `cardholder` and `cardLast4` set |
| Coverage month | Deposit statements: the month of the period end. Card statements: the month of the statement date |
| Column detection | Each amount item goes to the column whose header right edge is nearest (±14pt), measured per page |
| Payee | Block 1 stores a first-pass payee (the most specific description line). Block 2 replaces it with the cleaner |
| Password | `extractPdf(data, password?)` throws `PdfPasswordError('needed' | 'incorrect')`; the receipt status is `locked`. The password is passed through once and never stored or logged |
| Unrecognised files | Not stored. The receipt says so, so the file can be dropped again once an adapter exists |
| Account identity | `accounts.key = kind:last4:currency` so a card first seen as a repayment target (Block 2) upgrades in place when its statements arrive |

## File map

```
src/core/money.ts        parseAmount, formatSGD (plain, for logs and CLI)
src/core/dates.ts        MONTHS, isoFromDmy, isoFromDayMon, inferYear, monthOf, addDays
src/core/redact.ts       redact, lastFour, findIdentifiers
src/core/fingerprint.ts  normaliseRaw, fingerprint, assignFingerprints
src/pdf/extract.ts       extractPdf, groupLines, PdfPasswordError
src/adapters/types.ts    Adapter, ParsedStatement, ParsedRow, AccountRef, PdfDoc/Page/Line/Item
src/adapters/kit.ts      docText, isAmount, cents, headerColumns, nearestColumn, itemsBetween
src/adapters/dbs-consolidated.ts, dbs-savings.ts, uob-one.ts, uob-card.ts
src/adapters/index.ts    ADAPTERS, detectAdapter
src/reconcile.ts         reconcile
src/db/schema.ts         MIGRATIONS
src/db/open.ts           openDb
src/import/vault.ts      vaultRelPath, writeVault
src/import/importer.ts   importPdf, importFiles, findPdfs, ReceiptItem
src/cli/import.ts        npm run import -- <paths…>
src/server/app.ts        POST /api/import, POST /api/import/inbox
test/fixtures/pdf.ts     builder for synthetic PdfDoc fixtures
test/fixtures/synthetic/*.ts  one invented statement per layout
test/real/*.test.ts      reconciliation and import tests on real statements (skip when absent)
```

---

### Task 1: Money and dates

**Files:** Create `src/core/money.ts`, `src/core/dates.ts`. Test `src/core/money.test.ts`, `src/core/dates.test.ts`.

**Interfaces (produces):**
- `parseAmount(s: string): number | null` — `"1,234.56"` → `123456`, `"0.10"` → `10`, `"12"` → `null`, `"-"` → `null`.
- `formatSGD(cents: number): string` — `123456` → `"S$1,234.56"`, `-5` → `"−S$0.05"`.
- `isoFromDmy("01/08/2026")` → `"2026-08-01"`; `isoFromDayMon("22 JUL", 2026)` → `"2026-07-22"` (month names any case); `parseDayMonYear("20 AUG 2026")` → `"2026-08-20"`.
- `inferYear(month: number, refYear: number, refMonth: number): number` — month after the reference month means the previous year (`inferYear(12, 2026, 1)` → `2025`).
- `monthOf("2026-08-20")` → `"2026-08"`; `addDays(iso, n)`; `addMonths("2026-08", -1)` → `"2026-07"`.

- [ ] Write the tests for each example above. Run: FAIL. Implement. Run: PASS. Commit.

### Task 2: Redaction

**Files:** Create `src/core/redact.ts`. Test `src/core/redact.test.ts`.

**Interfaces:** `redact(text: string): string`, `lastFour(text: string): string | null` (last four digits of the longest digit run), `findIdentifiers(text: string): string[]` (NRIC/FIN matches and 8+ digit runs; used by the DB scan).

```ts
it('masks NRIC/FIN, card and account numbers, keeps amounts and short refs', () => {
  expect(redact('PTXP S1234567D IRAS')).toBe('PTXP [NRIC] IRAS');
  expect(redact('CCC - 4111111111111111 : I-BANK')).toBe('CCC - ·1111 : I-BANK');
  expect(redact('Account No. 123-456789-0')).toBe('Account No. ·7890');
  expect(redact('1234 5678 9012 3456')).toBe('·3456');
  expect(redact('PAYNOW TRANSFER 1234567')).toBe('PAYNOW TRANSFER 1234567');
  expect(redact('PURCH 3.90, CSHBACK 100.00')).toBe('PURCH 3.90, CSHBACK 100.00');
  expect(redact('BUS/MRT 123456789 SINGAPORE')).toBe('BUS/MRT ·6789 SINGAPORE');
});
it('finds what redaction would remove', () => {
  expect(findIdentifiers('ok 1,234.56 ·1111')).toEqual([]);
  expect(findIdentifiers('x T7654321Z y 12345678')).toEqual(['T7654321Z', '12345678']);
});
```

- [ ] Test, FAIL, implement, PASS, commit.

### Task 3: Fingerprints

**Files:** Create `src/core/fingerprint.ts`. Test `src/core/fingerprint.test.ts`.

**Interfaces:** `normaliseRaw(raw: string): string`; `fingerprint(parts: FingerprintParts, occurrence: number): string` (40 hex chars); `assignFingerprints<T extends FingerprintParts>(accountKey: string, rows: T[]): (T & { fingerprint: string })[]` where `FingerprintParts = { date: string; amountCents: number; raw: string; cardLast4?: string | null }`.

```ts
it('is stable across digit-only changes and whitespace', () => {
  const a = fingerprint({ accountKey: 'deposit:9012:SGD', date: '2026-08-01', amountCents: -800, raw: 'PAYNOW  TRANSFER 123' }, 0);
  const b = fingerprint({ accountKey: 'deposit:9012:SGD', date: '2026-08-01', amountCents: -800, raw: 'paynow transfer 999' }, 0);
  expect(a).toBe(b);
});
it('separates identical rows by occurrence', () => {
  const rows = assignFingerprints('card:9013:SGD', [
    { date: '2026-07-21', amountCents: -613, raw: 'BUS/MRT ·1357 SINGAPORE' },
    { date: '2026-07-21', amountCents: -613, raw: 'BUS/MRT ·2468 SINGAPORE' },
  ]);
  expect(rows[0]!.fingerprint).not.toBe(rows[1]!.fingerprint);
});
```

- [ ] Test, FAIL, implement, PASS, commit.

### Task 4: PDF text extraction

**Files:** Create `src/pdf/extract.ts`, `src/adapters/types.ts`. Test `src/pdf/extract.test.ts`.

**Interfaces:**
```ts
export interface PdfItem { str: string; x: number; y: number; w: number; r: number }
export interface PdfLine { y: number; items: PdfItem[]; text: string }
export interface PdfPage { number: number; lines: PdfLine[] }
export interface PdfDoc { pages: PdfPage[] }
export class PdfPasswordError extends Error { reason: 'needed' | 'incorrect' }
export function groupLines(items: PdfItem[], tolerance?: number): PdfLine[]; // top to bottom, items left to right, blank items dropped
export async function extractPdf(data: Uint8Array, password?: string): Promise<PdfDoc>;
```

```ts
it('groups items into lines top to bottom, left to right', () => {
  const lines = groupLines([
    { str: '1,234.56', x: 360, y: 137.4, w: 35, r: 395 },
    { str: '20/08/2026', x: 45, y: 137, w: 40, r: 85 },
    { str: 'Advice Bill Payment', x: 113, y: 137.2, w: 70, r: 183 },
    { str: 'CCC', x: 113, y: 127, w: 15, r: 128 },
    { str: ' ', x: 200, y: 127, w: 2, r: 202 },
  ]);
  expect(lines.map((l) => l.text)).toEqual(['20/08/2026 Advice Bill Payment 1,234.56', 'CCC']);
});
it('maps pdf.js password exceptions', async () => {
  // extractPdf is given a loader stub that throws { name: 'PasswordException', code: 1 }
});
```

- [ ] Test, FAIL, implement (pdf.js legacy build, `isEvalSupported: false`, `disableFontFace: true`, loader injectable for the password test), PASS, commit.

### Task 5: Adapter kit and reconciliation

**Files:** Create `src/adapters/kit.ts`, `src/reconcile.ts`. Test `src/adapters/kit.test.ts`, `src/reconcile.test.ts`.

**Interfaces:**
```ts
export interface AccountRef { bank: string; product: string; kind: 'deposit'|'card'|'wallet'|'loan'|'investment'; last4: string; currency: string; owner: 'me'|'joint'|'partner' }
export interface ParsedRow { date: string; postDate?: string; lines: string[]; amountCents: number; balanceCents?: number; fx?: { currency: string; amountCents: number }; cardholder?: string; cardLast4?: string }
export interface ParsedStatement {
  account: AccountRef;
  period: { start: string; end: string; month: string };
  openingCents: number; closingCents: number;
  printed: { debitsCents?: number; creditsCents?: number; closingCents?: number; subtotals?: { label: string; openingCents: number; cents: number; rowIdx: number[] }[]; amountDueCents?: number };
  rows: ParsedRow[];
  meta?: Record<string, number | string | null>;
}
export interface Adapter { id: string; version: number; bank: string; kind: string; detect(text: string): number; parse(doc: PdfDoc): ParsedStatement[] }
export interface Check { name: string; expected: number; actual: number; ok: boolean }
export interface ReconcileResult { ok: boolean; checks: Check[] }
export function reconcile(s: ParsedStatement): ReconcileResult;
```

Reconciliation rules:
- Deposit: `Σ outflows = printed debits`, `Σ inflows = printed credits` (each when printed), `opening + Σ amounts = closing`, `closing = printed closing` (when printed), and each row with `balanceCents` equals the running balance at that row.
- Card: `opening − Σ amounts = closing` (money owed goes up when you spend), `closing = printed amount due` (when printed), and each subtotal `opening + Σ(−amounts of its rows) = its cents`.
- A statement with no rows still reconciles when opening equals closing.

- [ ] Tests for a balanced deposit, a deposit with one wrong running balance, a card with a CR payment and a subtotal, and an empty statement. Test the kit's `nearestColumn` with header right edges `{ debit: 397, credit: 476, balance: 550 }` and amounts ending at 395, 474, 548 and 300 (none). FAIL, implement, PASS, commit.

### Task 6: DBS/POSB consolidated adapter

**Files:** Create `src/adapters/dbs-consolidated.ts`, `test/fixtures/pdf.ts`, `test/fixtures/synthetic/dbs-consolidated.ts`, `test/real/statements.real.test.ts`. Test `src/adapters/dbs-consolidated.test.ts`.

Layout (from the sample): "Consolidated Statement"; "Transaction Details as at DD Mon YYYY"; per account a line `<Product> Account No. <number>`; table header `Date Description Withdrawal (-) Deposit (+) Balance`; `CURRENCY: SINGAPORE DOLLAR` / `CURRENCY: UNITED STATES DOLLAR` switch sections; the first `Balance Brought Forward SGD x` of a section is the opening (later ones repeat the page carry); rows start with `dd/mm/yyyy` at the date column and continue on following description lines; a dated line with no withdrawal or deposit is a balance checkpoint, not a row; `Total Balance Carried Forward in SGD: W D B` gives printed totals and the closing. A name line ending in `/` in the page-1 header marks the account as joint.

- [ ] **Step 1:** Write `test/fixtures/pdf.ts` (builders: `doc(...pages)`, `page(...lines)`, `line(y, ...cells)`, `at(x, str)`, `right(rEdge, str)`; width = `str.length × 4.6`).
- [ ] **Step 2:** Write the synthetic fixture: joint account "ALEX TAN/ SAM LEE", product "My Account", account number with last four 9871, August 2026, two pages, rows: a cash-withdrawal purchase (outflow, three lines), a PayNow out, a FAST receipt in, a bill payment naming a 16-digit card, a page break with carry lines, a balance checkpoint line, and a USD section with no rows. Totals printed so everything reconciles.
- [ ] **Step 3:** Write the failing test: parse returns two statements (SGD, USD); SGD has owner `joint`, last4 `9871`, the right row count, amounts and dates, lines joined without the carry lines; `reconcile()` is ok for both.
- [ ] **Step 4:** Write `test/real/statements.real.test.ts`: for every PDF found in the inbox, `detectAdapter` picks exactly one adapter with confidence ≥ 0.5, `parse` returns at least one statement, and every statement reconciles; the failure message names the file and the failing check (never a figure beyond the check values).
- [ ] **Step 5:** Implement. Run the synthetic test and the real test with `TALLY_INBOX_DIR` set to the two sample folders: every DBS consolidated file reconciles.
- [ ] **Step 6:** Commit.

### Task 7: DBS savings adapter

**Files:** Create `src/adapters/dbs-savings.ts`, `test/fixtures/synthetic/dbs-savings.ts`. Test `src/adapters/dbs-savings.test.ts`.

Layout: "Details of Your DBS <Product> Account No.: <number>"; "As at DD Mon YYYY" gives the year and month; header `DATE DETAILS OF TRANSACTIONS WITHDRAWAL($) DEPOSIT($) BALANCE($)`; rows start `dd Mon`; continuation lines are indented; the balance appears only on the last row of each day; `Balance Brought Forward` (first = opening), `Total W D`, and the last `Balance Carried Forward` = closing.

- [ ] Synthetic fixture (owner me, last four 9876, February 2026: PayLah top-ups, a PayNow in, a GIRO, a bill payment, a cheque deposit with no continuation, interest) → failing test → implement → synthetic and real tests pass → commit.

### Task 8: UOB One Account adapter

**Files:** Create `src/adapters/uob-one.ts`, `test/fixtures/synthetic/uob-one.ts`. Test `src/adapters/uob-one.test.ts`.

Layout: "Statement of Account", "Period: DD Mon YYYY to DD Mon YYYY"; "Account Transaction Details"; `<Product> <number>` (+ "(continued)"); header `Date Description Withdrawals Deposits Balance`; `DD Mon BALANCE B/F x` = opening; every row carries a balance; `Total W D B`; "End of Transaction Details". Page-1 overview gives meta: `Credit Card Eligible Spend`, `Debit Card Eligible Spend`, `Bonus Interest earned` (`-` = null), the `^for <Month YYYY>` month they refer to, and year-to-date `Interest Earned`.

- [ ] Synthetic fixture (last four 5555, July 2026: bill payment to a card, IRAS GIRO naming an NRIC-shaped string, salary GIRO in, PayNow out, interest credit; overview with eligible spend and bonus "-") → failing test (rows, meta, reconcile ok, meta.bonusInterestCents null) → implement → pass → commit.

### Task 9: UOB credit card adapter

**Files:** Create `src/adapters/uob-card.ts`, `test/fixtures/synthetic/uob-card.ts`. Test `src/adapters/uob-card.test.ts`.

Layout: "Credit Card(s) Statement"; "Statement Date DD MON YYYY"; summary table rows `<CARD NAME> <card number> <NAME> <amount to pay> <minimum>` (names may wrap); sections headed by a product line then `<card number> <HOLDER>[ (continued)]`; `PREVIOUS BALANCE x`; rows `DD MON DD MON <description> <amount>[ CR]` then `Ref No. : …` and optionally `<CCY> <amount>`; `SUB TOTAL x` per cardholder; `TOTAL BALANCE FOR <PRODUCT> x` per account; "End of Transaction Details". The first section after each account total belongs to the principal card listed in the summary; later sections of the same product are supplementary cards.

- [ ] Synthetic fixture: two accounts (principal ·1111 with a supplementary ·2222 for "SAM LEE"; principal ·3333 alone), a year-rolling January statement with December rows, a CR payment, a refund CR, an FX row (USD), a section continued across a page. Failing test: two statements; amounts signed (purchases negative, CR positive); December rows dated the previous year; supplementary rows carry `cardholder` and `cardLast4`; FX parsed; `Ref No.` lines not in `lines`; reconcile ok, including subtotals and amount due.
- [ ] Implement → synthetic and real pass (all 7 card statements) → commit.

### Task 10: Adapter registry and detection

**Files:** Create `src/adapters/index.ts`. Test `src/adapters/index.test.ts`.

**Interfaces:** `ADAPTERS: Adapter[]`; `detectAdapter(doc: PdfDoc): { adapter: Adapter; confidence: number } | null` (highest confidence ≥ 0.5, else null).

- [ ] Test: each synthetic fixture is detected by its own adapter only; a doc with unrelated text returns null. FAIL, implement, PASS, commit.

### Task 11: Database

**Files:** Create `src/db/schema.ts`, `src/db/open.ts`. Test `src/db/open.test.ts`.

Migration 1 tables: `accounts(id, key UNIQUE, bank, product, kind, last4, currency, owner, seen_only_as_target, label)`, `files(id, sha256 UNIQUE, original_name, vault_path, adapter_id, adapter_version, month, imported_at)`, `statements(id, file_id → files ON DELETE CASCADE, account_id → accounts, month, period_start, period_end, opening_cents, closing_cents, printed_json, checks_json, reconciled, accepted, meta_json, UNIQUE(file_id, account_id))`, `transactions(id, statement_id → statements ON DELETE CASCADE, account_id → accounts, seq, date, post_date, raw, payee, amount_cents, balance_cents, fx_currency, fx_amount_cents, cardholder, card_last4, fingerprint UNIQUE, manual, kind, category, bucket, vendor, pair_fingerprint, target_account_id, needs_review, classified_by, note)`, indexes on `(account_id, date)`, `(date)`, `(kind)`.

**Interfaces:** `openDb(file: string): Database.Database` (creates the file, sets `journal_mode = DELETE`, `foreign_keys = ON`, `busy_timeout = 5000`, runs pending migrations inside a transaction, sets `user_version`).

```ts
it('uses a rollback journal, not WAL', () => {
  const db = openDb(tmpFile());
  expect(db.pragma('journal_mode', { simple: true })).toBe('delete');
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
});
it('is idempotent across re-opens', () => { /* open twice, same user_version, tables intact */ });
```

- [ ] Test, FAIL, implement, PASS, commit.

### Task 12: Importer, vault and receipts

**Files:** Create `src/import/vault.ts`, `src/import/importer.ts`. Test `src/import/importer.test.ts`.

**Interfaces:**
```ts
export type ReceiptStatus = 'imported' | 'duplicate' | 'unrecognised' | 'failed' | 'locked';
export interface ReceiptItem { name: string; status: ReceiptStatus; detail: string; statements?: { account: string; month: string; rows: number; reconciled: boolean }[] }
export interface ImportDeps { extract?: (data: Uint8Array, password?: string) => Promise<PdfDoc>; now?: () => Date }
export async function importPdf(db, paths: Paths, file: { name: string; data: Uint8Array; password?: string }, deps?: ImportDeps): Promise<ReceiptItem>;
export async function importFiles(db, paths, files: { name: string; data: Uint8Array }[], deps?): Promise<{ items: ReceiptItem[]; summary: string }>;
export function findPdfs(dirs: string[]): string[]; // recursive, *.pdf, sorted
export function vaultRelPath(bank: string, accountSlug: string, month: string, kind: string): string; // e.g. dbs/my-account-9871/2026-08-consolidated.pdf
```

Behaviour: SHA-256 first (duplicate → receipt `duplicate`, nothing written); extract (password error → `locked`); detect (none → `unrecognised`); parse and reconcile each statement; upsert accounts by key (a `seen_only_as_target` account becomes seen); write the vault copy (suffix `-2`, `-3` on a name clash); insert file, statements and rows in one transaction; rows whose fingerprint already exists are skipped (overlapping statements); `raw` and `payee` are redacted; the original file name is redacted; receipt `failed` when any statement does not reconcile (rows stored, held out), else `imported`. Summary copy: "3 statements imported. 1 already here." (sentence case, counts only).

- [ ] Tests with an injected `extract` that returns the synthetic fixtures: imports and writes the vault file; second import of the same bytes is `duplicate` and adds no rows; a different file whose statement overlaps adds only new rows; an unbalanced fixture is `failed` and its statement has `reconciled = 0`; an unknown layout is `unrecognised` and writes nothing; a `PdfPasswordError` is `locked`; no NRIC or 8+ digit run in any stored text (`findIdentifiers` over every text column).
- [ ] FAIL, implement, PASS, commit.

### Task 13: CLI and inbox scan

**Files:** Create `src/cli/import.ts`. Modify `src/config.ts` (add `inboxDirs: string[]` from a `;`-separated `TALLY_INBOX_DIR`). Test `src/cli/import.test.ts` (argument resolution: files and directories expand to PDFs; no argument means the inbox).

- [ ] `npm run import -- <paths…>` prints one line per file (status word, file name, detail) and the summary. A `locked` file prompts for its password on a TTY (input hidden) and retries once; the password is not echoed, logged or stored.
- [ ] Test, FAIL, implement, PASS, commit.

### Task 14: API

**Files:** Modify `src/server/app.ts`, `src/server/main.ts`. Test `src/server/import.test.ts`.

- [ ] `POST /api/import` (multipart `files`, optional `password`) → `{ items, summary }`. `POST /api/import/inbox` → the same for the inbox. The context carries the open database. Tests use an injected extractor and a temp data dir. FAIL, implement, PASS, commit.

### Task 15: Real end-to-end import

**Files:** Create `test/real/import.real.test.ts`.

- [ ] Import every inbox PDF into a temp data dir: every receipt is `imported`; every statement has `reconciled = 1`; importing again gives only `duplicate` and the row count is unchanged; the DB scan finds no identifiers in any text column and every `accounts.last4` matches `^\d{0,4}$`; the vault holds one file per import.

### Task 16: Verify Block 1

- [ ] `npm test` (synthetic) and `npm run typecheck` pass.
- [ ] With `TALLY_INBOX_DIR` pointing at the two sample folders: the real tests pass, and `npm run import` into a temp data dir reports every file imported, then every file already here.
- [ ] Code review (superpowers:requesting-code-review) against this plan and the CLAUDE.md rules. Fix what it finds.
- [ ] Merge to `main`.

**Done-check (PRD §8):** all 28 sample PDFs import. All 21 deposit statements and all 7 card statements reconcile to printed totals and balances. Re-importing is a no-op. The DB scan finds no NRIC and no number longer than four digits in any account field.
