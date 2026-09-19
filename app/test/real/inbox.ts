import fs from 'node:fs';
import path from 'node:path';
import { getPaths } from '../../src/config';

/**
 * Real statements are read from TALLY_INBOX_DIR (a ";"-separated list is allowed) or
 * inputs/statements/. Tests that need them skip when none are found. Nothing here is ever
 * copied into the repo.
 */
export function realPdfs(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.pdf')) out.push(p);
    }
  };
  for (const d of getPaths().inboxDirs) walk(d);
  return out.sort();
}

export const hasRealStatements = realPdfs().length > 0;
