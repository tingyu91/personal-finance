import fs from 'node:fs';
import path from 'node:path';
import { findPdfs } from '../import/importer';

/** Files and folders from the command line become a list of PDFs; no arguments means the inbox. */
export function resolveInputs(args: string[], inboxDirs: string[]): { files: string[]; skipped: string[] } {
  if (args.length === 0) return { files: findPdfs(inboxDirs), skipped: [] };
  const files: string[] = [];
  const skipped: string[] = [];
  for (const arg of args) {
    const p = path.resolve(arg);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) files.push(...findPdfs([p]));
    else if (fs.existsSync(p) && p.toLowerCase().endsWith('.pdf')) files.push(p);
    else skipped.push(p);
  }
  return { files: [...new Set(files)], skipped };
}
