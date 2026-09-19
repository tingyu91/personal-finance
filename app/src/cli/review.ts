// npm run review -- 2026-08 — write outputs/reviews/review-2026-08.md (the latest month if none given).
import { ensureDirs, getPaths } from '../config';
import { openDb } from '../db/open';
import { dataMonths } from '../reports/months';
import { writeMonthlyReview } from '../review';

function main() {
  const paths = getPaths();
  ensureDirs(paths);
  const db = openDb(paths.dbFile);
  try {
    const asked = process.argv[2];
    if (asked && !/^\d{4}-(0[1-9]|1[0-2])$/.test(asked)) throw new Error('Give the month as YYYY-MM, like 2026-08.');
    const month = asked ?? dataMonths(db).at(-1);
    if (!month) throw new Error('No statements yet, so there is no month to review.');
    console.log(`Wrote ${writeMonthlyReview(db, paths, month)}`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
