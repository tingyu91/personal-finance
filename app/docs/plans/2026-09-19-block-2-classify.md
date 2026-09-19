# Block 2 — Classify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every imported row gets a kind (and, for spending, a category) without input where the statements make it clear; the rest land in Review, never in spending. Manual decisions survive re-parsing and "Rebuild from vault".

**Architecture:** `classify/pipeline.ts` is a pure function over rows, accounts, settings, rules and decisions that returns one result per row plus any card accounts seen only as repayment targets. `classify/run.ts` loads from SQLite, calls it, creates the seen-only accounts and writes the results back in one transaction. Import runs classification after every batch. Decisions live in their own table keyed by fingerprint and are applied last.

**Tech Stack:** TypeScript, better-sqlite3, Vitest.

**Spec:** `../../../prd/pending/prd-tally-personal-finance-2026-09-19.md` (§3, §4.4, §5 Classification/Manual entries/Vault, §7.2, §7.3, §8 Block 2)

## Global Constraints

- `kind` ∈ spend, income, transfer, card-repayment, investment, wallet-topup, refund, fee, tax, partner-contribution, plus `unclassified` for Review rows. Only spend, fee and tax count as spending; only income counts as income. Unclassified rows count as neither and are shown as "not yet sorted".
- A positive `spend` row (a merchant credit with no matching charge) reduces spending in its category. A matched charge and refund are both `refund` and cancel out.
- Categories take chart slots 1–8 for life: Food & groceries, Transport, Home running, Home project, Health & personal care, Shopping & subscriptions, Travel & leisure, Family & giving; Other is slot 0. Income uses Salary, Interest, Other income (no slot).
- Self and partner aliases live in `data/rules/settings.json` (gitignored), never in code. Tests use invented names.
- Self-alias matching looks at the counterparty (cleaned payee) only, never the free-text reference, because vendor payments carry Ting Yu's name in their reference line.
- Decisions are keyed by fingerprint, never row id, and win over every rule.

## Decisions settled for this block

| Question | Choice | Why |
|---|---|---|
| Order | Decisions that set a kind (they lock their rows first) → refund pairs → your rules → own-account transfers → card repayments → investments and wallets → partner contributions → self-alias transfers with an unseen side → seeded rules → defaults → note, vendor and bucket from decisions | PRD §7.3. Decisions go first so a decided row is never taken by a pair; your rules come before every other automatic step so a rule can override them (a refund pair cancels out whatever a rule says, so it goes first). Rows with a hard identity (card bill, broker, salary, tax, PayLah) are kept out of transfer pairing so a broker withdrawal is never mistaken for an own transfer |
| Transfer pairing | Outflow in one owned deposit account, inflow of the same amount and currency in another, within ±3 days; both sides must look like a transfer (a self-alias payee or a bank-transfer marker such as I-BANK, :IB, Funds Trf, FUNDS TRANSFER, UOVBSGSG, DBSSSGSG); rows from held statements and partner rows never pair | Equal amounts between unrelated payments are common; requiring both sides keeps false pairs out, and ±3 days covers a transfer sent on a Friday and credited on a Monday |
| Refund pairing | Same account (or any account when the inflow says REFUND), opposite sign, same amount, inflow within 30 days after the outflow, a shared significant word in the text (generic banking words excluded), and evidence: a refund or reversal word, or the same account and no transfer look | The sample has a same-day loan reversal, marketplace refunds, a delivery refund and a waived card fee; an own transfer out and back must not pair as a refund |
| Card repayments | Bank side: bill payments naming a card (CCC -, AMEX-, mBK-Citi CC, mBK-AMEX, mBK-UOB Cards) link to the card by last four; a card with no statements becomes a `seen_only_as_target` account (issuer from the text where it says so). Card side: inflows such as "DBS Visa Direct", "PAYMT THRU E-BANK", "DBS BANK" are repayments, paired with the bank side by last four, amount and ±7 days | PRD §7.3 step 3 |
| Partner contributions | Inflows whose payee matches a partner alias, or inflows into a joint account whose text matches a partner reference pattern (settings) | The partner's transfers into the joint account arrive from their bank without their name, only a purpose line |
| Defaults | Card outflows, and deposit outflows on card-terminal or merchant-QR rails (NETS, POS, debit card): spend, Other, flagged for review. Every other unmatched bank outflow (PayNow and FAST to people or companies) and every unmatched inflow: unclassified, waiting in Review, counted as neither spending nor income | PRD §4.4: the rest land in Review, never in spending. A PayNow to a company may be a vendor, a broker or a friend's business, so it waits for a decision |
| Payee | A cleaner per layout picks the counterparty line, strips company suffixes and locations, and title-cases shouting text. Seed rules may set a canonical payee (e.g. "Bus/MRT") | PRD §7.2 "payee (cleaned)" |

## File map

```
src/db/schema.ts            migration 2: decisions, rules
src/settings.ts             loadSettings, DEFAULT_SETTINGS (data/rules/settings.json)
src/classify/categories.ts  CATEGORIES, KINDS, SPENDING_KINDS, slotOf
src/classify/payee.ts       cleanPayee(raw, bank)
src/classify/text.ts        significantWords, matchesAlias, TRANSFER_MARKERS
src/classify/cards.ts       cardTarget(raw) → { issuer, last4 } | null, isCardRepaymentInflow(raw)
src/classify/seeds.ts       SEED_RULES (ordered)
src/classify/pipeline.ts    classify(input) → { results, newAccounts }
src/classify/run.ts         classifyAll(db, settings), accountsFor, rowsFor
src/decisions.ts            setDecision, addPayeeRule, listRules
src/import/rebuild.ts       rebuildFromVault
src/cli/rebuild.ts          npm run rebuild
src/server/app.ts           POST /api/rebuild, PATCH /api/transactions/:fingerprint
```

---

### Task 1: Migration 2 and settings

**Files:** Modify `src/db/schema.ts`. Create `src/settings.ts`. Test `src/settings.test.ts`, extend `src/db/open.test.ts`.

Migration 2:
```sql
CREATE TABLE decisions (
  fingerprint TEXT PRIMARY KEY,
  kind TEXT, category TEXT, bucket TEXT, vendor TEXT, note TEXT, split_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('seed', 'user')),
  priority INTEGER NOT NULL DEFAULT 0,
  field TEXT NOT NULL CHECK (field IN ('payee', 'raw')),
  pattern TEXT NOT NULL,
  is_regex INTEGER NOT NULL DEFAULT 0,
  sign TEXT CHECK (sign IN ('in', 'out')),
  account_id INTEGER REFERENCES accounts(id),
  set_kind TEXT, set_category TEXT, set_bucket TEXT,
  created_at TEXT NOT NULL
);
```

**Interfaces:** `interface Settings { self: { aliases: string[] }; partner: { name: string; aliases: string[]; refPatterns: string[] }; idleCashMonths: number; marginalTaxRate: number | null }`; `loadSettings(paths): Settings` (writes the default file when missing, merges missing keys, never overwrites the user's values).

- [ ] Tests: default file created with empty aliases; user values preserved; unknown keys kept; invalid JSON throws a message naming the file. Migration 2 applies on an existing v1 database. FAIL → implement → PASS → commit.

### Task 2: Categories, kinds and text helpers

**Files:** Create `src/classify/categories.ts`, `src/classify/text.ts`. Tests beside them.

- [ ] `CATEGORIES` in slot order; `slotOf('Transport') === 2`, `slotOf('Other') === 0`, unknown → 0. `SPENDING_KINDS = ['spend', 'fee', 'tax']`.
- [ ] `significantWords('PayNow Transfer 1234 · To: CAROUSELL TRANSACTION')` → `['carousell', 'transaction']` (generic banking words and short words removed). `matchesAlias('Alex Tan DBS', ['ALEX TAN'])` true; `matchesAlias('SAMSUNG STORE', ['SAM'])` false (word boundary).
- [ ] FAIL → implement → PASS → commit.

### Task 3: Payee cleaner

**Files:** Create `src/classify/payee.ts`. Test `src/classify/payee.test.ts`.

**Interfaces:** `cleanPayee(raw: string, bank: string, accountKind: AccountKind): string` where `raw` is the stored text (lines joined by " · ").

Examples (invented):

| raw | payee |
|---|---|
| `Advice FAST Payment / Receipt · PAYNOW TRANSFER 1234567 · TO: EXAMPLE STUDIO PTE. LTD. · ALEX TAN · OTHER` | `Example Studio` |
| `FAST Payment / Receipt · Incoming PayNow Ref 0000001 · From: JOHN DOE · Other` | `John Doe` |
| `Advice FAST Payment / Receipt · SAM HOUSEHOLD AUG · ·0001OCBCSGSGBRT7000001 · OTHER` | `Sam Household Aug` |
| `Advice Bill Payment · CCC - ·1111 : I-BANK · REF: ·3456` | `Card ·1111` |
| `Bill Payment · mBK-Citi CC · ·7102` | `Citi card ·7102` |
| `Funds Transfer · TOP-UP TO PAYLAH! : · ALEX TAN · PLPE·0001` | `PayLah top-up` |
| `PAYNOW-FAST · PIB·7104 · EXAMPLE PAINT PTE. LTD · OTHR 123` | `Example Paint` |
| `Inward CR - GIRO · SALA Salary Payment · EXAMPLE EMPLOYER PTE. · ·7107P00XXX` | `Example Employer` |
| `Inward DR - GIRO · TAXS [NRIC] · IRAS · Income Tax` | `IRAS` |
| `Misc Debit · DR CO CHARGES · CO-·1234` | `Cashier's order` |
| `Advice Point-Of-Sale Transaction or Proceeds · NETS QR PAYMENT ·1234 · TO: MR EXAMPLE` | `Mr Example` |
| `Point-of-Sale Transaction · ·1234,EXAMPLE TEA SINGAPORE PTE LTD` | `Example Tea` |
| `EXAMPLE MART-WEST MALL Singapore` (card) | `Example Mart-West Mall` |
| `Spotify P000A00A00 Stockholm` (card) | `Spotify` |
| `Interest Earned` | `Interest` |
| `Mortgage Loan · ·1234` | `Mortgage loan` |

- [ ] Test table → FAIL → implement → PASS → commit.

### Task 4: Card targets and repayment inflows

**Files:** Create `src/classify/cards.ts`. Test `src/classify/cards.test.ts`.

- [ ] `cardTarget('Advice Bill Payment · CCC - ·1111 : I-BANK · REF: ·3456')` → `{ issuer: null, last4: '1111' }`; `'… AMEX-·7101 : I-BANK …'` → `{ issuer: 'Amex', last4: '7101' }`; `'Bill Payment · mBK-Citi CC · ·7102'` → `{ issuer: 'Citi', … }`; `'Bill Payment · mBK-UOB Cards · ·7103'` → UOB; a PayNow → null. `isCardRepaymentInflow('DBS Visa Direct')`, `'PAYMT THRU E-BANK/HOMEB/CYBERB (EP06)'`, `'DBS BANK Singapore'` true; `'CR ANNUAL RENEWAL FEE'`, `'LALAMOVE Singapore'` false.
- [ ] FAIL → implement → PASS → commit.

### Task 5: The pipeline

**Files:** Create `src/classify/pipeline.ts`, `src/classify/seeds.ts`. Test `src/classify/pipeline.test.ts`, `src/classify/seeds.test.ts`.

**Interfaces:**
```ts
export interface ClassifyRow { id: number; fingerprint: string; accountId: number | null; date: string; amountCents: number; raw: string; manual: boolean }
export interface ClassifyAccount { id: number; key: string; bank: string; kind: AccountKind; last4: string; owner: Owner; seenOnly: boolean }
export interface RuleRow { id: number; source: 'seed' | 'user'; priority: number; field: 'payee' | 'raw'; pattern: string; isRegex: boolean; sign: 'in' | 'out' | null; accountId: number | null; setKind: Kind | null; setCategory: string | null; setBucket: string | null }
export interface DecisionRow { fingerprint: string; kind: Kind | null; category: string | null; bucket: string | null; vendor: string | null; note: string | null }
export interface Result { id: number; payee: string; kind: Kind; category: string | null; bucket: string | null; vendor: string | null; note: string | null; pairFingerprint: string | null; target: { accountId?: number; newKey?: string } | null; needsReview: boolean; classifiedBy: string }
export interface NewAccount { key: string; bank: string; product: string; kind: 'card'; last4: string }
export function classify(input: { rows: ClassifyRow[]; accounts: ClassifyAccount[]; settings: Settings; rules: RuleRow[]; decisions: DecisionRow[] }): { results: Result[]; newAccounts: NewAccount[] };
```

One test per step, each with invented rows (ALEX TAN is self, SAM LEE is partner):
- [ ] Refunds: a −1,234.56 "Mortgage Loan" and +1,234.56 "Mortgage Loan" on the same day pair as `refund`; a −12.34 "To: SHOPLINK TRANSACTION" and a +12.34 "SHOPLINKPAYME … Refund" 5 days later pair; a PayLah top-up and a "MAXED OUT FROM PAYLAH" of the same amount do not pair; an own transfer out and back does not pair as a refund.
- [ ] Transfers: −5,000 "UOB:·1234:I-BANK Transfer" in savings and +5,000 "OTHR Other · ALEX TAN · Transfer" in another account three days later pair as `transfer`; a −50 PayNow to "JOHN DOE" and a +50 "From: MARY LIM" in another account do not; a self-alias side with a side that does not look like a transfer does not; different currencies and held statements never pair.
- [ ] Card repayments: "CCC - ·1111" −234.56 in savings and "DBS Visa Direct" +234.56 on card ·1111 pair; a supplementary card's last four resolves to its principal card account; "AMEX-·7101" with no Amex account yields a `newAccounts` entry `card:7101:SGD` (issuer Amex) and a `target.newKey`.
- [ ] Investments and wallets: known brokers ("STASHAWAY PTE. LTD.") either way are `investment`, in bank accounts only; "TOP-UP TO PAYLAH" is `wallet-topup`; "WISE ASIA-PACIFIC" PayNow is `wallet-topup`; "MAXED OUT FROM PAYLAH" is `transfer`.
- [ ] Partner: "+1,500 HOME FUND · ·0101OCBCSGSGBRT7000001" into a joint account with refPattern `OCBCSGSGBRT` is `partner-contribution`; the same text into a `me` account is not; "From: SAM LEE" is.
- [ ] Self alias: "+2,000 INWARD TRF - TT · … · ALEX TAN" with no pair is `transfer`; "PAYNOW-FAST · EXAMPLE STUDIO · OTHR ALEX TAN" is not (alias only in the reference).
- [ ] Rules: a user rule on the displayed payee beats a seed and the automatic steps; seeds classify "BUS/MRT ·1234 SINGAPORE" (card) as spend/Transport with payee "Bus/MRT", "SALA Salary Payment" as income/Salary, "TAXS … IRAS" as tax, "PTXP … IRAS" as spend/Home running, "CARD MEMBERSHIP FEE" as fee.
- [ ] Defaults: an unmatched card purchase is spend/Other with `needsReview`; a NETS or debit card payment from a deposit account is spend/Other with `needsReview`; a PayNow to "JOHN DOE" or to "EXAMPLE PTE. LTD." from a deposit account is `unclassified` with `needsReview`; an unmatched inflow is `unclassified`; an unmatched card credit is `unclassified`.
- [ ] Decisions: a decision on a fingerprint overrides kind and category and clears `needsReview`; a decided row is never taken by a pair, and its partner row stays free to pair elsewhere; a category alone implies its kind.
- [ ] FAIL → implement → PASS → commit.

### Task 6: Run against the database, after every import

**Files:** Create `src/classify/run.ts`. Modify `src/import/importer.ts` (`importFiles` calls `classifyAll` once per batch when anything was imported). Test `src/classify/run.test.ts`.

- [ ] Importing the synthetic statements classifies every row (no `kind IS NULL`); the card repayment pair links `target_account_id`; a seen-only account is created once and reused on re-run; running twice gives identical results (idempotent). FAIL → implement → PASS → commit.

### Task 7: Decisions and "always for this payee"

**Files:** Create `src/decisions.ts`. Modify `src/server/app.ts`. Test `src/decisions.test.ts`, `src/server/decisions.test.ts`.

**Interfaces:** `setDecision(db, fingerprint, patch: Partial<Pick<DecisionRow, 'kind' | 'category' | 'bucket' | 'vendor' | 'note'>>, opts?: { always?: boolean })` (upserts the decision; with `always`, adds a user rule on the row's payee; then re-runs `classifyAll`). `PATCH /api/transactions/:fingerprint` with `{ kind?, category?, bucket?, vendor?, note?, always? }`.

- [ ] Tests: the decision sticks; `always` stores the resolved kind in the rule and classifies other rows with the same payee, and the response says how many rows the rule covers; unknown or contradictory values (an income category on spending, a bucket on a transfer, a non-text note) are rejected with a 400 and a plain message; a missing row or decision is a 404. Decision endpoints wait behind a running import. FAIL → implement → PASS → commit.

### Task 8: Rebuild from vault

**Files:** Create `src/import/rebuild.ts`, `src/cli/rebuild.ts`. Modify `src/import/importer.ts` (split into `readPdf`, async and read-only, and `storeParsed`, synchronous), `package.json` (`"rebuild": "tsx src/cli/rebuild.ts"`), `src/server/app.ts` (`POST /api/rebuild`). Test `src/import/rebuild.test.ts`.

- [ ] Rebuild reads and parses every vault file before writing anything. Then, in one transaction, each file that read cleanly replaces its old rows inside its own savepoint, keeping its vault path, original name, import date and any "accept these totals". A file that is missing, locked, not recognised or throws, or whose new reading clashes with another file, keeps its old rows and is reported "Kept as it was". Then re-classify, and report decisions that no longer match a row. Manual entries, decisions and user rules are never touched. Tests with the injected extractor: two decisions still apply; row and vault file counts unchanged; manual entry fields unchanged; import date and accepted flag kept; locked, unrecognised, throwing, missing and clashing files each keep their rows while the rest rebuild. FAIL → implement → PASS → commit.

### Task 9: Real statements

**Files:** Create `test/real/classify.real.test.ts`.

- [ ] Import the sample into a temp data dir with settings aliases supplied through `TALLY_TEST_SETTINGS` (a JSON path; skipped when absent), then: no row has `kind IS NULL`; every bank-side card bill payment is `card-repayment`; every PayLah top-up is `wallet-topup`; every bank row naming a known broker is `investment`; at least 95% of non-spend flows are automatic (see Task 10); exactly five `seen_only_as_target` card accounts exist, each with repayments; rebuilding keeps a decision set on a real row.

### Task 10: Verify Block 2

- [ ] `npm test`, `npm run typecheck`.
- [ ] Classification report on the sample (script output, not committed): counts by kind; the Review queue listed by payee; the share of non-spend flows classified automatically, computed as auto non-spend rows ÷ (auto non-spend rows + Review rows that are really transfers, repayments, investment moves or refunds), with the judgement for each Review row recorded in the block report.
- [ ] The real test repeats that check without judgement: every row still in Review whose text looks like money between accounts (a transfer marker, a self alias, a card bill, a telegraphic transfer, a cheque) counts as a miss. Some of those are real payments, so the automated figure under-counts.
- [ ] Code review, fixes, merge.

**Done-check (PRD §8):** on the sample, ≥95% of non-spend flows are classified without input. Re-parsing keeps every manual decision. The five unseen card accounts appear with their totals.
