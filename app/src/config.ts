import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where everything lives. `root` is the personal-finance/ folder that holds app/. */
export interface Paths {
  root: string;
  dataDir: string;
  dbFile: string;
  vaultDir: string;
  rulesDir: string;
  /** The first inbox folder (inputs/statements unless overridden). */
  inboxDir: string;
  /** Every inbox folder: TALLY_INBOX_DIR may list several, separated by path.delimiter. */
  inboxDirs: string[];
  outputsDir: string;
  reviewsDir: string;
  exportsDir: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function getPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const dataDir = env.TALLY_DATA_DIR ? path.resolve(env.TALLY_DATA_DIR) : path.join(ROOT, 'data');
  const outputsDir = env.TALLY_OUTPUTS_DIR ? path.resolve(env.TALLY_OUTPUTS_DIR) : path.join(ROOT, 'outputs');
  const inboxDirs = env.TALLY_INBOX_DIR
    ? env.TALLY_INBOX_DIR.split(path.delimiter).filter(Boolean).map((d) => path.resolve(d))
    : [path.join(ROOT, 'inputs', 'statements')];
  const inboxDir = inboxDirs[0]!;
  return {
    root: ROOT,
    dataDir,
    dbFile: path.join(dataDir, 'tally.db'),
    vaultDir: path.join(dataDir, 'vault'),
    rulesDir: path.join(dataDir, 'rules'),
    inboxDir,
    inboxDirs,
    outputsDir,
    reviewsDir: path.join(outputsDir, 'reviews'),
    exportsDir: path.join(outputsDir, 'exports'),
  };
}

/** Creates the machine-writable trees. Never touches inputs/ (human-maintained). */
export function ensureDirs(p: Paths): void {
  for (const d of [p.dataDir, p.vaultDir, p.rulesDir, p.reviewsDir, p.exportsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
