// npm run rebuild — re-read every PDF in the vault with today's adapters. Your decisions stay.
import { ensureDirs, getPaths } from '../config';
import { openDb } from '../db/open';
import { rebuildFromVault } from '../import/rebuild';

async function main() {
  const paths = getPaths();
  ensureDirs(paths);
  const db = openDb(paths.dbFile);
  try {
    const res = await rebuildFromVault(db, paths);
    for (const i of res.items) console.log(`${i.status.padEnd(14)} ${i.name}  ${i.detail}`);
    console.log(`\n${res.summary}`);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
