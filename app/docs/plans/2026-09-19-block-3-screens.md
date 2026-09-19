# Block 3 — Statements, Transactions, Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three everyday screens on the Tally design system: Statements (drop, scan, coverage, history, failed reconciliations), Transactions (ledger, filters, search, inline and bulk decisions, manual entries), Overview (a month's spending, income, savings, investments, cash on hand, category bars against their six-month median, the coverage banner).

**Architecture:** Report queries live in `src/reports/` as pure functions over the database and are unit-tested with the invented fixtures. The API exposes them as JSON. The UI ports the design-system components to typed React (`web/src/ds/`), and each screen fetches through a small `api.ts` client. Charts are hand-built SVG following the dataviz skill.

**Tech Stack:** React 18, Vite 6, Hono, Vitest + Testing Library (jsdom), lucide-react.

**Spec:** `../../../prd/pending/prd-tally-personal-finance-2026-09-19.md` (§4.1, 4.5–4.7, 4.11; §5 Import, Manual entries, Cash on hand; §7.4 screens 1, 2, 5; §8 Block 3). Design: `../../../design-system/README.md` and each component README.

## Global Constraints

- Every screen is built with the frontend-design skill on the Tally design system; the system wins where they disagree. Tokens only, no raw hex. Geist and Geist Mono only. One `figure-display` per screen, one primary button per screen.
- Copy: sentence case, second person, number first then reason, no emoji, no exclamation marks. Estimates say "about". Spending is never red; `critical` only for things that are wrong.
- Amounts render through `Amount` (true minus, `+` for inflows, muted for transfers). Tables show cents; headlines may round.
- Only SGD rows are summed. Rows from a statement that does not reconcile (and was not accepted) are left out of every total, and the screen says so.
- Coverage first: any total for a month with a missing statement or unseen spending carries the coverage banner.
- Charts: one axis, thin marks (bars ≤ 24px, 4px rounded data end, square at the baseline), categories keep their slot colour, text never takes a series colour, every bar carries its label and value (light-mode contrast for slots 3–5 needs it), per-bar hover and focus tooltip, a table view.
- Works in light and dark, at 1280px and at 400px.

## Decisions settled for this block

| Question | Choice | Why |
|---|---|---|
| Headline "money spent" | Everyday spending: spend + fee + tax, excluding the Home project category. The home project amount for the month shows beneath it and links to the Home project screen | A property purchase would otherwise swamp every month it touches; PRD insight 6 already treats the home project apart |
| Net savings | Income − all spending (home project included). Savings rate = net ÷ income | Honest: money that left is money not saved |
| Moved to investments | − Σ investment rows (net) for the month | PRD §2: "moved to investments", neither spend nor income |
| Cash on hand | Σ of each SGD deposit account's latest closing balance at or before the month; a stale balance (older month) is flagged | PRD §5 "comes almost free" |
| Category median | Median of that category's monthly spending over the six months before, counting only months that have data | PRD §7.4 |
| Category bars | Everyday categories only; the home project has its own line under the headline and its own screen. Tax and fees have no category and are named in a note under the bars, so bars + tax + fees = the headline | Settled while building: the bars and the headline must add up |
| Wallet unseen money | Top-ups less money the wallet sends back ("MAXED OUT FROM PAYLAH"), never below zero in a month | Settled while building: money that came back was not spent |
| Coverage cells | `ok` when the account has a statement that month, or when it is a card and a statement file from the same adapter covers that month (the card had no activity); `missing` otherwise, including every month of a card seen only as a repayment target. Months run from the earliest to the latest statement month | Design system CoverageGrid; PRD §4.7 |
| Unseen spending | Repayments to seen-only cards + wallet top-ups, per month | PRD §3.2, insight 1 |
| Receipt statuses | The DropZone port adds `locked` (Needs password), `conflict` (Clashes) and `error` (Not imported) to the design system's four, each with its word | The importer can return them; each needs its own honest word |
| Failed reconciliation | Statements screen lists them with the failing check, "Open PDF", "Accept these totals" and "Remove". Accepting counts the rows; removing deletes the file, its statements and rows (decisions stay) | PRD §4.2 "until Ting Yu resolves it" |
| Manual entries | Date, amount (out or in), payee, kind, category, optional account, optional bucket, note. Stored as a manual row plus its decision, so a rebuild keeps it | PRD §5 |
| Routing state | Filters live in the hash query (`#/transactions?month=2026-08&review=1`) so links from Overview land filtered | Deep links from the banner and "not yet sorted" |

## File map

```
src/reports/months.ts        monthRange, statementMonths
src/reports/coverage.ts      coverage(db) → { months, current, rows[] }
src/reports/overview.ts      overview(db, month) → OverviewData
src/reports/ledger.ts        listTransactions(db, filters) → { rows, total, sums }
src/reports/statements.ts    listFiles(db), acceptStatement, removeFile
src/manual.ts                addManualEntry, deleteManualEntry
src/server/app.ts            GET /api/meta, /api/accounts, /api/coverage, /api/overview, /api/transactions,
                             /api/files, /api/files/:id/pdf; POST /api/statements/:id/accept,
                             /api/transactions/manual; DELETE /api/files/:id, /api/transactions/:fp
web/src/api.ts               typed fetch client
web/src/format.ts            formatSGD (port), shortDate, monthLabel
web/src/ds/                  Button, Amount, Stat, CategoryChip, TransactionRow, DropZone, CoverageGrid, Insight (+ tests)
web/src/charts/CategoryBars.tsx, MonthColumns.tsx (+ tests)
web/src/screens/Statements.tsx, Transactions.tsx, Overview.tsx (+ tests with a stubbed api)
```

---

### Task 1: Reports — months, coverage, overview

**Files:** Create `src/reports/months.ts`, `coverage.ts`, `overview.ts` with tests.

**Interfaces:**
```ts
export interface CoverageRow { accountId: number; account: string; kind: string; seenOnly: boolean; cells: ('ok' | 'missing' | 'na')[]; unseenCents: number[] }
export function coverage(db: Db): { months: string[]; rows: CoverageRow[] };
export interface OverviewData {
  month: string; months: string[];
  spentCents: number; homeProjectCents: number; incomeCents: number; netCents: number; savingsRate: number | null;
  investedCents: number; cashOnHandCents: number; cashStale: string[]; cashTrend: { month: string; cents: number }[];
  partnerCents: number;
  categories: { name: string; slot: number; cents: number; medianCents: number | null }[];
  notSorted: { count: number; cents: number };
  coverage: { complete: boolean; missing: string[]; unseenCents: number; held: string[] };
}
export function overview(db: Db, month: string): OverviewData;
```

- [ ] Tests with the invented fixtures: coverage shows the seen-only card missing in every month and the cards from one UOB file all `ok`; overview for the fixture month: spent excludes transfers, repayments, top-ups, investments and refund pairs; home project is separate; a held (unreconciled) statement's rows are left out and listed in `coverage.held`; the median ignores the current month.
- [ ] FAIL → implement → PASS → commit.

### Task 2: Ledger query, statements admin, manual entries

**Files:** Create `src/reports/ledger.ts`, `src/reports/statements.ts`, `src/manual.ts` with tests.

- [ ] `listTransactions(db, { month?, accountId?, category?, kind?, review?, q?, limit?, offset? })`: newest first; `q` matches payee, raw and note, case-insensitive; returns `{ rows: TransactionView[], total, outCents, inCents }`.
- [ ] `listFiles(db)`: each file with its statements (account label, month, rows, reconciled, accepted, failing check), newest month first. `acceptStatement(db, id)`, `removeFile(db, paths, id)` (removes the vault copy too; decisions stay).
- [ ] `addManualEntry(db, paths, entry)` → fingerprint `manual:<uuid>`, stores the row and its decision, re-classifies; `deleteManualEntry` only deletes manual rows.
- [ ] FAIL → implement → PASS → commit.

### Task 3: API for the screens

**Files:** Modify `src/server/app.ts`. Test `src/server/screens.test.ts`.

- [ ] `GET /api/meta` (categories with slots, kinds, buckets, months, whether aliases are set), `GET /api/accounts`, `GET /api/coverage`, `GET /api/overview?month=`, `GET /api/transactions?…`, `GET /api/files`, `GET /api/files/:id/pdf` (application/pdf from the vault, `Content-Disposition: inline`), `POST /api/statements/:id/accept`, `DELETE /api/files/:id`, `POST /api/transactions/manual`, `DELETE /api/transactions/:fingerprint` (manual only; 400 otherwise).
- [ ] FAIL → implement → PASS → commit.

### Task 4: Design-system components as typed React

**Files:** Create `web/src/format.ts`, `web/src/ds/*.tsx`, `web/src/ds/ds.test.tsx`.

- [ ] Same props and classes as `design-system/components/bundle.js` and `index.d.ts`. Tests: `Amount` renders `−S$1,234.56` with `aria-label="Out S$1,234.56"`, `+S$10.00` for inflows, muted class for transfers; `CategoryChip` slot 0 uses `ink-muted`; `CoverageGrid` cells carry glyph and `aria-label`; `DropZone` shows the receipt with the right pill words (including the three added statuses) and opens the picker on Enter; `Insight` always shows its level word.
- [ ] FAIL → implement → PASS → commit.

### Task 5: Statements screen

**Files:** Modify `web/src/screens/Statements.tsx`. Create `web/src/api.ts`. Test `web/src/screens/Statements.test.tsx`.

- [ ] Drop zone posts the files and shows the receipt; a `locked` item offers a password field that re-sends that one file (the password is not kept). "Scan inbox" (quiet). Coverage grid with the legend words. "Needs a look": failed reconciliations with the failing check, Open PDF, Accept these totals, Remove (with a confirming step). Import history table. "Where to get statements" notes per bank (DBS/POSB digibank, UOB TMRW/PIB, Citi, Amex) with no links out.
- [ ] Test with a stubbed `api`: dropping files renders the summary and pills; the password field appears for a locked file.
- [ ] Screenshots (light, dark, 1280, 400) and a look.

### Task 6: Transactions screen

**Files:** Modify `web/src/screens/Transactions.tsx`. Test `web/src/screens/Transactions.test.tsx`.

- [ ] One filter row above the ledger (month, account, category, kind, Review only, search). Rows use `TransactionRow` with a checkbox; selecting shows a bulk bar (Set category, Mark as transfer, Tag to home project, Clear). Activating a row opens an inline editor: kind, category, bucket, note, "Always do this for <payee>", Save. "Add manual entry" (the one primary button) opens a small form. A notice appears when no self aliases are set.
- [ ] Test with a stubbed `api`: filters build the query; saving a category calls PATCH with `always`.
- [ ] Screenshots and a look.

### Task 7: Overview screen and charts

**Files:** Create `web/src/charts/CategoryBars.tsx`, `web/src/charts/MonthColumns.tsx` with tests. Modify `web/src/screens/Overview.tsx`. Test `web/src/screens/Overview.test.tsx`.

- [ ] Month picker (previous/next and a select). Coverage banner when incomplete or with unseen spending (links to Statements). Headline "Spent in <Month>" as the one figure-display, with the home project and "not yet sorted" lines beneath (links to Home project and the filtered Review). Four stat tiles: income (with partner contributions noted), net savings with rate, moved to investments, cash on hand (stale balances noted). "Where it went": CategoryBars, each bar labelled with its category and value, a median tick, hover and focus tooltips, and "Show as table". Cash on hand as MonthColumns with the current month in accent. A slot for the top three insights (filled in Block 5).
- [ ] Tests: bars keep slot colours when sorted; every bar has a text label; the table view lists the same numbers.
- [ ] Screenshots and a look.

### Task 8: Verify Block 3

- [ ] `npm test`, `npm run typecheck`.
- [ ] Drag all 28 sample PDFs onto the Statements screen in headless Edge (set files on the input): the receipt shows 28 imported.
- [ ] The coverage grid shows the five cards seen only as repayment targets missing in every month.
- [ ] Hand check: August 2026 spending, income and net savings from an independent SQL query over the stored rows, compared with the Overview API, within S$1.
- [ ] Code review, fixes, merge.

**Done-check (PRD §8):** dragging 28 PDFs shows a receipt. The coverage grid shows the unseen cards as missing in every month. August 2026 on Overview matches a hand check within S$1.
