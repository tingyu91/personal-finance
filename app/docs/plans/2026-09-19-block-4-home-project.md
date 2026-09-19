# Block 4 — Home project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One screen, two clicks from Overview, that answers "how much did the home cost": the total by bucket, by vendor (with contract sums and balances) and by who paid, a cumulative line, the money that may be missing during the project, budget against actual, and a CSV export that opens cleanly in Excel.

**Architecture:** Migration 3 adds `projects` and `vendors`. `src/reports/home.ts` is a pure query over the database that returns everything the screen shows; one SQL predicate decides which rows belong to the project, and Overview uses the same predicate so the two screens always agree. `src/home.ts` holds the project and vendor edits. `src/reports/homeCsv.ts` writes the export. The screen reuses the design-system ports and adds one chart, `CumulativeLine`.

**Tech Stack:** TypeScript, better-sqlite3, Hono, React 18, Vitest + Testing Library.

**Spec:** `../../../prd/pending/prd-tally-personal-finance-2026-09-19.md` (§4.5, §5 home project, §7.2 projects and vendors, §7.3 step 5, §7.4 screen 3, §8 Block 4, §9 home project start, §10 Q2 and Q4).

## Global Constraints

- Integer cents; format at render only. Only SGD rows that count (reconciled or accepted statements, or manual entries) are summed.
- Only `spend`, `fee` and `tax` rows are home spending. A refund row inside the project nets off through its pair, never twice.
- Figures and names from the real statements never enter the repo: fixtures and tests use invented vendors (EXAMPLE RENO, LUMEN LIGHTING, SOFA HOUSE).
- Design system: tokens only, Geist, one `figure-display`, one primary button, sentence case, no advice, spending never red. Charts: 2px line, markers of at least 8px, one axis, hover and focus tooltips, a table view. Light and dark, 1280px and 400px.
- The CSV is for Excel: UTF-8 with a byte-order mark, CRLF line ends, every text field quoted, text that starts with `=`, `+`, `-` or `@` prefixed with `'`, amounts as plain numbers with two decimals, ISO dates.

## Decisions settled for this block

| Question | Choice | Why |
|---|---|---|
| Which rows are the home project | Spending rows (`spend`, `fee`, `tax`) with category Home project **or** a bucket | Tagging a bucket is an explicit act; one predicate shared with Overview keeps the headline and this screen consistent |
| Rows with no bucket | Shown as "Needs a bucket" with a link to those rows | PRD done-check: every home payment appears in a bucket |
| Project period | One project, "Home". Start defaults to the first month with statements (PRD §9: editable); end is open until set | The PRD has one home |
| Vendors | A vendor has a name, a match text (case-insensitive, matched against the payee and the statement text) and an optional contract sum. A row's vendor is the vendor you set on it, else the first vendor whose match hits, else its payee | Contract sums need a named vendor; everything else groups by payee |
| Who paid | By the paying account's owner: you, the joint account, or the partner when the cardholder on a card row is the partner. Manual entries with no account count as you | PRD §7.4 "Who paid" |
| Partner contributions | Inflows of kind partner-contribution during the project, listed with their purpose text; when the purpose shares a word with a vendor's name or match, the vendor is suggested | PRD §7.3 step 5 |
| Unseen during the project | Repayments to cards with no statements plus wallet top-ups (net of money sent back), from the start month on, with the card list | PRD §4.5, never cut |
| Large unsorted payments | Review rows of S$500 or more out during the project are counted with a link, since some may be for the home | Most of the renovation sits in Review until sorted once |
| Export | `GET /api/home/export.csv` writes `outputs/exports/home-project-YYYY-MM-DD.csv` and returns the same bytes as a download | PRD §7.1 outputs/exports |

## File map

```
src/db/schema.ts             migration 3: projects, vendors
src/reports/months.ts        IN_PROJECT predicate (shared with overview)
src/reports/home.ts          homeProject(db, settings) → HomeData
src/reports/homeCsv.ts       homeCsv(data) → string; writeHomeCsv(paths, data) → file path
src/home.ts                  getProject, updateProject, addVendor, updateVendor, deleteVendor
src/server/home.ts           GET /api/home, PATCH /api/home/project, POST/PATCH/DELETE /api/home/vendors, GET /api/home/export.csv
web/src/charts/CumulativeLine.tsx (+ test)
web/src/screens/HomeProject.tsx (+ test)
```

---

### Task 1: Migration 3 and the benchmarks file

**Files:** Modify `src/db/schema.ts`. Create `rules/benchmarks.default.json`, `src/benchmarks.ts`. Test `src/db/open.test.ts`, `src/benchmarks.test.ts`.

```sql
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, start_month TEXT NOT NULL, end_month TEXT, budget_cents INTEGER, created_at TEXT NOT NULL);
CREATE TABLE vendors (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, match TEXT NOT NULL, contract_cents INTEGER, note TEXT);
```

- [ ] The project predicate `IN_PROJECT` already exists (Block 3 review) and Overview uses it.
- [ ] `data/rules/benchmarks.json` holds every threshold and outside figure with its `checked_on` date (PRD §4.8). The first run copies `rules/benchmarks.default.json` from the repo; after that the file is yours. Block 4 uses `thresholds.largeUnsortedCents`; Block 5 uses the rest. Tests: created on first run; a section you left out falls back to the default; a wrong type or a missing `checked_on` names the key.

### Task 2: The home report

**Files:** Create `src/reports/home.ts`. Test `src/reports/home.test.ts` with the synthetic statements plus manual entries and decisions.

**Interfaces:**
```ts
export interface HomeData {
  project: { id: number; name: string; startMonth: string; endMonth: string | null; budgetCents: number | null };
  totalCents: number;
  buckets: { bucket: string | null; cents: number; count: number }[];   // null = needs a bucket
  vendors: { id: number | null; name: string; contractCents: number | null; paidCents: number; balanceCents: number | null; lastPaid: string; count: number }[];
  payers: { payer: 'me' | 'joint' | 'partner'; label: string; cents: number }[];
  contributions: { date: string; purpose: string; cents: number; account: string; suggestedVendor: string | null }[];
  contributionsCents: number;
  cumulative: { month: string; cents: number }[];
  unseen: { cents: number; accounts: { account: string; cents: number }[] };
  unsortedLarge: { count: number; cents: number };
  rows: { fingerprint: string; date: string; payee: string; vendor: string; bucket: string | null; payer: string; account: string; cents: number; note: string | null; raw: string }[];
}
```

- [ ] Tests: the total equals the sum of `rows`; each bucket equals the sum of its rows; a vendor's balance is contract − paid; a decision's vendor beats a match; a partner's supplementary card row counts as the partner; a contribution whose purpose names a vendor suggests it; unseen money counts only from the start month; a row in a held statement is left out.

### Task 3: Project and vendor edits, API and export

**Files:** Create `src/home.ts`, `src/reports/homeCsv.ts`, `src/server/home.ts`. Modify `src/server/app.ts`, `web/src/api.ts`. Tests beside each.

- [ ] Validation with plain messages: months as YYYY-MM, end not before start, budget and contract sums as positive amounts, a vendor needs a name and a match. Writes go through the serial queue.
- [ ] CSV test: the BOM, CRLF, quoting of commas and quotes, `=SUM(1)` in a note becomes `'=SUM(1)`, amounts `1234.56`, and one line per row plus the header.

### Task 4: The screen

**Files:** Create `web/src/charts/CumulativeLine.tsx`. Modify `web/src/screens/HomeProject.tsx`. Tests beside them.

- [ ] Headline "Spent on the home" as the one figure-display, with the period and "about S$X more may be missing" when unseen money exists. Budget against actual when a budget is set, and a small form to set the period and budget. Bucket breakdown (with "Needs a bucket" linking to those rows). Vendor table with contract sum, paid, balance and last payment, plus "Add vendor". Who paid, then the partner's contributions with suggested vendors. The cumulative line. Unseen during the project with the card list. Large unsorted payments with a link to Review. "Export CSV" as the primary button. The row list at the end.
- [ ] Tests with a stubbed API: the headline and buckets; the vendor form calls the API; export link; empty state when there are no home rows.
- [ ] Screenshots in light and dark at 1280px and 400px.

### Task 5: Verify Block 4

- [ ] `npm test`, `npm run typecheck`.
- [ ] On the sample (scratch data folder): every home row has a bucket; the total, each bucket and each vendor equal the sum of their rows (independent SQL); the export opens in Excel (headless check: parse it back, count the lines, check the BOM and that no cell starts with a formula character).
- [ ] Code review, fixes, merge.

**Done-check (PRD §8):** every sample home payment appears in a bucket, the totals equal the sum of their rows, and the export opens cleanly in Excel.
