# Tally build log

One entry per PRD block: what was built, the done-check result, and anything Ting Yu should know.
Figures from the real statements stay out of this file; it lives in git.

---

## Block 0 — Setup (2026-09-19)

**Done-check:** met. `npm run dev` shows the empty rail layout; screenshots taken in light and dark at
1280px and 400px. `npm test` passes (13 tests).

- 0.1 PRD approved as written (go-ahead recorded from Ting Yu's instruction; he asked for one report at
  the end instead of a check-in after each block).
- 0.2 **Still Ting Yu's step.** The statements are still in `DBS Statements/` and `UOB statements/`.
  Claude never writes to `inputs/`. Until they move, point the app at them with
  `TALLY_INBOX_DIR="<pf>\DBS Statements;<pf>\UOB statements"`.
- 0.3 Superpowers and frontend-design were already installed.
- 0.4 Domain registered: root `CLAUDE.md`, `memory/personal-finance/context.md`, AI OS PRD §11,
  `TASKS.md`, `cowork-project-instructions.md` (the Cowork UI paste is still manual).
- 0.5 Scaffold: Vite 6 + React 18 + TypeScript, Hono on 127.0.0.1:5317, Vitest 3, tokens compiled from
  `design-system/tokens.json`, Geist fonts vendored through @fontsource.

**Deviation:** `better-sqlite3` is pinned to 11.10.0. Version 12 has no prebuilt binary for Node 20 on
Windows and this machine has no C++ toolchain. Vite 6 and Vitest 3 are used because Vite 7+ needs
Node 20.19.

## Block 1 — Import, parse, reconcile (2026-09-19)

**Done-check:** met.

- All 28 sample PDFs import (CLI, drop zone API and inbox scan share one importer).
- All 21 deposit statements (plus the empty USD pocket of the joint account, parsed as its own
  statement) and all 7 card statements reconcile to their printed totals, balances, per-cardholder
  subtotals and amounts to pay, to the cent.
- Re-importing is a no-op: every file comes back "Already here".
- The database scan finds no NRIC and no number of eight or more digits in any text column; every
  account stores at most its last four digits.

What reconciliation cannot catch, a row audit did: card statements were attaching the next page's
"Page n of m" header to the last row of a page. Fixed with a regression test.

## Block 2 — Classify (2026-09-19)

**Done-check:** met.

- ≥95% of non-spend flows classified without input. By judgement on the Review queue, about 99%:
  the only real misses are two telegraphic transfers, two cheque deposits and one transfer out to
  another bank. The real test repeats the check with no judgement, counting every Review row that
  looks like money between accounts as a miss, and still clears 95%.
- Re-parsing keeps every decision. The real test sets one, rebuilds from the vault, and it holds.
- The five unseen card accounts appear with their repayments: two Amex, one Citi, and two whose bill
  payments name no issuer. The Citi card's last four is not the one PRD §2 guessed.

Decisions taken while building:

- **Unmatched bank payments wait in Review; they are not spending.** Only card purchases and
  card-terminal or merchant-QR payments (NETS, POS, debit card) default to spending (Other,
  flagged). A PayNow to a company could be a vendor, a broker or a friend, so it waits for you,
  as PRD §4.4 says. Expect a Review queue of bank payments to sort once; "always for this payee"
  clears most of them.
- **Own transfers pair within ±3 days**, and both sides must look like a transfer (your name or a
  bank-transfer marker). A weekend transfer takes three days to land.
- **Refund pairs need evidence** (a refund word, or a same-account reversal). Before this, an own
  transfer out and back was pairing as a refund.
- **Your rules run before transfer, card and wallet matching** and match on the payee you see,
  so a rule can override a wrong automatic call. Only refund pairs come first, because a refund
  cancels out whatever a rule would say.
- **Picking a category brings its kind along.** "Salary" on a row you had called spending makes it
  income; contradictions (a category on a transfer, a home bucket on income) are refused.
- **Rebuild from vault never loses rows.** A file that no longer reads (missing, locked, not
  recognised, or clashing with another file) keeps its old rows and says "Kept as it was".
  Sorting runs in the same transaction, so a failure there changes nothing. Import dates carry
  over, and so does "accept these totals" when the statement reads the same. Known limit: when an
  adapter fix moves a statement from one file to another, the first rebuild may keep one file as
  it was; a second rebuild settles it.
- **settings.json is checked.** A wrong type names the key; blank aliases are dropped (they would
  match every row); the file is rewritten only when a key is missing.
- **Seeds are generic.** Merchant names that only your statements would know stay out of the code.
  Sort them once with "always for this payee"; those rules live in your database, not in git.

## Block 3 — Statements, Transactions, Overview (2026-09-19)

**Done-check:** met, on a scratch copy of the data (the real folder is untouched).

- Setting all 28 sample PDFs on the Statements drop zone in headless Edge gives the receipt
  "28 statements imported."
- The coverage grid shows the five cards Tally only sees as repayment targets as missing in every
  month (and the two wallets).
- August 2026 on Overview matches an independent SQL total over the stored rows to the cent for
  spending, the home project, income and net savings.
- Screens checked in light and dark at 1280px and 400px.

Decisions taken while building:

- **The headline is everyday spending.** Tax and fees are in it; the home project is not, and shows
  on its own line under it. The category bars leave out the home project, and a note names the tax
  and fees, so the bars and the headline add up.
- **A home row is spending with category Home project, or any spending with a bucket.** Overview and
  the Home project screen share that one rule.
- **Card statements run from the 21st to the 20th.** When a month's card rows stop at the 20th, the
  month is marked incomplete and the banner says so; held statements are matched by their period.
- **Money a wallet sends back** ("MAXED OUT FROM PAYLAH") nets against its top-ups in the unseen figure.
- **Partner transfers with only a FAST code** ("OTHER") show the partner's name as payee.
- **Removing a file** also removes an account left with no statements; a card still repaid from
  your accounts goes back to being a card Tally only sees as a repayment target.
- **Manual entries** are checked like decisions (a category matches its kind, buckets only on
  spending) and must be dated within a month of today.
