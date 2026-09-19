import fs from 'node:fs';
import path from 'node:path';

/**
 * The vault keeps the app's own copy of every imported PDF (PRD §5), named
 * {bank}/{account}/{YYYY-MM}-{kind}.pdf so "Rebuild from vault" can re-read everything.
 * Only the last four digits ever appear in a path.
 */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function vaultRelPath(bank: string, product: string, last4: string, month: string, kind: string): string {
  const account = [slug(product), last4].filter(Boolean).join('-');
  return `${slug(bank)}/${account}/${month}-${kind}.pdf`;
}

export interface StagedFile {
  /** The relative path the file will have once committed. */
  rel: string;
  /** Moves the staged copy into place. Call after the database commit. */
  commit(): void;
  /** Removes the staged copy. Never throws, so it cannot hide the error that caused it. */
  discard(): void;
}

/**
 * Writes the PDF under a staging name first (-2, -3 … when the final name is taken) so a crash
 * before the database commit never leaves a vault file the database does not know about.
 */
export function stageVault(vaultDir: string, rel: string, data: Uint8Array): StagedFile {
  const ext = path.extname(rel);
  const base = rel.slice(0, -ext.length);
  let candidate = rel;
  for (let n = 2; fs.existsSync(path.join(vaultDir, candidate)) || fs.existsSync(path.join(vaultDir, `${candidate}.part`)); n++) {
    candidate = `${base}-${n}${ext}`;
  }
  const final = path.join(vaultDir, candidate);
  const part = `${final}.part`;
  fs.mkdirSync(path.dirname(final), { recursive: true });
  fs.writeFileSync(part, data, { flag: 'wx' });
  return {
    rel: candidate,
    commit: () => fs.renameSync(part, final),
    discard: () => {
      try {
        fs.rmSync(part, { force: true });
      } catch {
        // Leave it; an orphaned .part file is harmless and never read.
      }
    },
  };
}
