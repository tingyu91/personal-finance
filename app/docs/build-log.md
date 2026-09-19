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

## Block 4 — Home project (2026-09-19)

**Done-check:** met, on a scratch copy of the data.

- Every home payment Tally can see on the sample sits in a bucket (purchase, renovation or
  furnishing); none needs one.
- The total, each bucket, the vendors and the payers each equal the sum of their rows, checked
  against an independent SQL query to the cent.
- The CSV export opens in Excel itself: nine columns, one line per payment, every amount read as a
  number and every date as a date, no formulas and no error cells. It carries a byte-order mark and
  CRLF line ends, and text that starts with =, +, - or @ is defused.

What the screen shows: the total as the one headline, the period and budget (editable), about how
much more may be missing (repayments to cards with no statements, and wallet top-ups, during the
project), large payments still in Review, the split by bucket and by who paid, the partner's
transfers into the joint account whose purpose names something for the home, vendors with contract
sums and balances, a running total by month, the unseen cards, and every payment.

Decisions taken while building:

- **One project, "Home".** Until you set a start it follows the first month with statements (PRD §9),
  so importing older statements later moves it back; nothing is stored until you edit it. The end
  and budget stay open until you set them. Every home row counts whatever its date; the period
  frames the unseen money, the partner's transfers and payments after the end.
- **The export is a button, not a link:** it asks the local server (a POST, so no other website can)
  and downloads the file. If the saved copy is open in Excel, the download still works and says so.
- **A vendor** is a name and the text that marks it on a statement; its contract sum is optional. A
  vendor you set on a row wins over a match; anything unmatched groups by payee.
- **Who paid** follows the paying account: you, the joint account, or the partner when the cardholder
  on a card row is the partner.
- **Partner transfers** count toward the home when their purpose line names a vendor, a seeded home
  merchant or a renovation word (lighting, sofa, tap, deposit, and so on). They are shown, never added
  to the total, because the joint-account payments they funded are already counted.
- **Most of the renovation is still outside the total.** On the sample, the large renovation
  payments made by bank transfer wait in Review, and much more went to cards with no statements.
  Sorting the Review queue once and adding the missing card statements (Block 6) completes the answer.


## Block 5 — Insights and the monthly review (2026-09-19)

**Done-check:** met for rules 1, 2 and 4; rule 3 is quiet on the sample for a good reason (below).

- All ten rules are pure functions over a snapshot of the data, each with fixture tests (25 tests).
  Every threshold and outside figure lives in `data/rules/benchmarks.json` with the date it was
  checked; rules on outside facts drop from Act to Watch when that date is over 180 days old.
- On the sample (scratch copy), eight insights are live:
  - Rule 1, Act: the money repaid to cards with no statements and topped up to wallets, with the
    card list and all its rows.
  - Rule 2, Act: the UOB One account paid no bonus interest in any month. UOB's own printed
    eligible card spend was below the S$500 minimum UOB lists (checked 2026-09-19) while a salary
    credit was present; the worth comes from the tier table on the account's average balance.
  - Rule 4, Watch: card membership fees and telegraphic transfer charges, annualised.
  - Rules 5 and 6 also fire (regular monthly charges; four categories above 1.5 times their median
    in August).
- Every insight opens its rows on Transactions (checked for each live insight).
- The monthly review writes `outputs/reviews/review-YYYY-MM.md` from the Insights screen or
  `npm run review -- 2026-08`.

**Deviation: rule 3 does not fire on the two identical marketplace payments.** PRD §3.6 expected
them to. The statements show both were refunded (one the same day, one 30 days later), so Tally
pairs each with its refund and there is nothing left to chase. The rule is covered by its fixture
tests. Recurring payments of the same amount to the same person (three or more) are a series,
not duplicates, and are left out.

Sources checked on 2026-09-19 for `rules/benchmarks.default.json`: IRAS (SRS cap S$15,300 for
citizens and PRs; CPF cash top-up relief up to S$8,000 for yourself and S$8,000 for family). The UOB
One page did not load, so its tiers come from a review site quoting it (growbeansprout.com,
8 Sep 2026); the file says so. Check the UOB figures on uob.com.sg before relying on rule 2's
estimate.

## Block 6 — Missing card adapters (ongoing)

Nothing to build yet: no statements for the cards Tally only sees as repayment targets have been
added. When one arrives, add an adapter in `src/adapters/` test first (a synthetic fixture that is
committed, and a reconciliation test against the real PDF that skips when it is absent), hold it
to the cent like the others, and check the card's unseen figure falls to zero for those months.
