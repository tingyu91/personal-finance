# Block 5 — Insights and the monthly review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ten insight rules of PRD §7.5, each a pure function with a fixture test, reading every rate and threshold from the dated benchmarks file; the Insights screen (dismiss and snooze); the top three on Overview; every insight linking to the rows behind it; and an on-demand `outputs/reviews/review-YYYY-MM.md`.

**Architecture:** `src/insights/snapshot.ts` reads the database once into a plain `Snapshot` (counted rows, accounts, statements with their printed meta and balances, coverage, last import date, the home project). `src/insights/rules.ts` holds the ten rules as pure functions of a snapshot, so each is tested with a hand-built fixture. `src/insights/index.ts` runs them, hides dismissed and snoozed ones (migration 4), and resolves an insight's rows for the Transactions filter. `src/review.ts` writes the monthly markdown.

**Tech Stack:** TypeScript, better-sqlite3, Hono, React 18, Vitest.

**Spec:** `../../../prd/pending/prd-tally-personal-finance-2026-09-19.md` (§3, §4.8, §5 insight rules and monthly review, §7.4 screen 4, §7.5, §8 Block 5).

## Global Constraints

- No advice: insights state facts and dated rules ("UOB lists a S$500 minimum card spend, checked 2026-09-19"). Never recommend a product, trade or investment.
- Rules that rest on outside facts show "checked on {date}" and drop from Act to Watch when that date is more than `outsideFactsStaleDays` (180) old.
- Every threshold comes from `data/rules/benchmarks.json`; nothing is hard-coded in a rule.
- Worth estimates only where honest, labelled "about".
- Fixtures and tests use invented names and figures.

## Decisions settled for this block

| Question | Choice | Why |
|---|---|---|
| Insight identity | A stable key per finding (rule and subject, such as the two fingerprints of a duplicate pair). Dismissing hides that key; snoozing hides it until a date | A new finding gets a new key and shows again |
| Rows behind an insight | `#/transactions?insight=<key>`: the ledger asks the server for that insight's fingerprints | PRD §4.8: every insight links to its rows |
| UOB One bonus | Uses UOB's own printed "eligible spend" and "bonus interest earned" from the statement, a salary credit (SALA ≥ the dated minimum) in the account that month, and the dated tier table on the average end-of-day balance | Compute from the actual balance, never assume (PRD §3.7) |
| Possible duplicates | Same payee and amount, within the dated window, at or above the dated minimum, among spending and unsorted payments | Leaves out bus fares and coffee |
| Subscriptions | A payee charging in 3+ consecutive months with amounts within the dated tolerance, still charging last month | PRD §7.5 rule 5 |
| Monthly review | Written on demand from the Insights screen or `npm run review -- 2026-08`, to `outputs/reviews/`. It holds figures, so it stays local | PRD §5 |

## File map

```
src/db/schema.ts            migration 4: dismissed_insights
src/insights/rules.ts       the ten rules, runRules(snapshot)
src/insights/snapshot.ts    snapshot(db, paths, today)
src/insights/index.ts       listInsights, dismissInsight, restoreInsight, insightFingerprints
src/review.ts               monthlyReview(db, paths, month) → markdown; writeMonthlyReview
src/cli/review.ts           npm run review -- YYYY-MM
src/server/insights.ts      GET /api/insights, POST/DELETE /api/insights/:key/dismiss, POST /api/review/:month
src/reports/ledger.ts       fingerprints filter
web/src/screens/Insights.tsx, Overview.tsx (top three), Transactions.tsx (insight filter)
```

---

### Task 1: Rules as pure functions

**Files:** Create `src/insights/rules.ts`. Test `src/insights/rules.test.ts`.

- [ ] One test per rule with a hand-built snapshot: fires with the right level, title, evidence and fingerprints; stays quiet when the condition is not met; rules on outside facts turn Watch after 180 days.

### Task 2: Snapshot, dismiss and snooze, the row filter

**Files:** Modify `src/db/schema.ts`, `src/reports/ledger.ts`. Create `src/insights/snapshot.ts`, `src/insights/index.ts`, `src/server/insights.ts`. Tests beside them.

- [ ] The snapshot from the synthetic statements has counted rows only, UOB One meta, card repayment targets and the home project. Dismissed keys stay hidden; snoozed keys return after their date. `GET /api/transactions?insight=<key>` lists exactly the insight's rows.

### Task 3: Monthly review

**Files:** Create `src/review.ts`, `src/cli/review.ts`. Modify `package.json`. Test `src/review.test.ts`.

- [ ] The markdown has the month's coverage, headline figures, categories against their median, the home project, live insights and the Review queue count. It is written to `outputs/reviews/review-YYYY-MM.md`.

### Task 4: Screens

**Files:** Modify `web/src/screens/Insights.tsx`, `web/src/screens/Overview.tsx`, `web/src/screens/Transactions.tsx`, `web/src/api.ts`. Tests beside them.

- [ ] Insights: grouped Act, Watch, Info with the design-system `Insight`; each has "See the rows" where it has rows, Dismiss and "Snooze 30 days"; "Write this month's review" as the one primary action. Overview: the top three under the charts with a link to all. Transactions: an insight filter with a way back.
- [ ] Screenshots in light and dark at 1280px and 400px.

### Task 5: Verify Block 5

- [ ] `npm test`, `npm run typecheck`.
- [ ] On the sample: rules 1 (unseen money), 2 (UOB One bonus missed), 3 (the two identical marketplace payments a week apart) and 4 (fees) fire with the evidence PRD §2–3 describes; their rows open from the insight.
- [ ] Code review, fixes, merge.

**Done-check (PRD §8):** each rule has a fixture-based test. On the sample, rules 1, 2, 3 and 4 fire with the evidence described in §2–3.
