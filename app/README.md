# Tally

A local app that reads bank and card e-statements (PDF) and answers three questions: where the
money went, how much the home cost, and what is worth changing. It runs on your own computer,
listens on 127.0.0.1 only, and makes no network calls.

**This repository holds code only.** Statements, the database, the PDF vault, settings and
reports live in folders beside `app/` (`data/`, `inputs/`, `outputs/`) and are never committed.
Tests use invented statements.

## Run it

Node 20.11 or later.

```
npm install
npm run dev        # API on 127.0.0.1:5317 and the UI on http://127.0.0.1:5173
npm start          # one server with the built UI
```

Folders, relative to the folder that holds `app/`:

| Folder | What | Override |
|---|---|---|
| `data/` | `tally.db`, `vault/` (a copy of every imported PDF), `rules/settings.json`, `rules/benchmarks.json` | `TALLY_DATA_DIR` |
| `inputs/statements/` | where you put statement PDFs for "Scan inbox" (read only) | `TALLY_INBOX_DIR` (several folders separated by `;`) |
| `outputs/` | `reviews/review-YYYY-MM.md`, `exports/home-project-*.csv` | `TALLY_OUTPUTS_DIR` |

`data/rules/settings.json` is created on first run. Add how your name appears on statements
(`self.aliases`) so transfers between your own accounts are recognised, and your partner's
(`partner.aliases`, `partner.refPatterns`) if you share a joint account. `data/rules/benchmarks.json`
holds every rate and threshold the insights use, each with the date it was checked.

Command line:

```
npm run import -- <file-or-folder> ...   # import PDFs (no arguments: the inbox)
npm run rebuild                          # re-read every PDF in the vault; your decisions stay
npm run review -- 2026-08                # write outputs/reviews/review-2026-08.md
```

## What it does

- **Import:** DBS/POSB consolidated and savings statements, UOB One Account and UOB credit cards.
  Every statement is reconciled to its printed totals and balances to the cent; one that does not
  add up is held out of every total until you accept it. Card and account numbers and NRICs are
  redacted before anything is stored. Re-importing is a no-op.
- **Classify:** own-account transfers, card repayments, investment moves, wallet top-ups, refund
  pairs and partner contributions are matched so nothing is counted twice. Your decisions and
  "always for this payee" rules survive re-parsing.
- **Screens:** Overview (the month, against each category's six-month median, with a coverage
  banner whenever statements are missing), Transactions (ledger, Review queue, bulk actions, manual
  entries), Home project (buckets, vendors, who paid, what may be missing, CSV for Excel),
  Insights (ten dated rules, dismiss or snooze) and Statements (drop zone, coverage grid).

## Develop

```
npm test           # unit, API and screen tests (real-statement tests skip without statements)
npm run typecheck
```

Block plans and the build log are in `docs/`. A new bank layout is an adapter in `src/adapters/`
with `detect` and `parse`, written test first against a reconciliation check.

Insights state facts and dated rules. They are not financial advice.
