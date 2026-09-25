// npm run import -- <files or folders…>   (no arguments: the inbox, inputs/statements/)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { ensureDirs, getPaths } from '../config';
import { openDb } from '../db/open';
import { importPdf, sortAfterImport, summarise, type ReceiptItem } from '../import/importer';
import { resolveInputs } from './args';

const WORD: Record<ReceiptItem['status'], string> = {
  imported: 'Imported',
  duplicate: 'Already here',
  unrecognised: 'Not recognised',
  failed: 'Totals don’t match',
  locked: 'Needs password',
  conflict: 'Clashes',
  error: 'Not imported',
};

/** Reads a line without echoing it. The password lives only in this call's memory. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    process.stdout.write(question);
    out._writeToOutput = () => undefined;
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const paths = getPaths();
  ensureDirs(paths);
  const { files, skipped } = resolveInputs(process.argv.slice(2), paths.inboxDirs);
  for (const s of skipped) console.log(`Skipped      ${s} (not a PDF or not found)`);
  if (files.length === 0) {
    console.log(`No PDFs found. Drop statements into ${paths.inboxDir} or pass their paths.`);
    return;
  }
  const db = openDb(paths.dbFile);
  const items: ReceiptItem[] = [];
  for (const file of files) {
    const name = path.basename(file);
    let item: ReceiptItem;
    try {
      const data = new Uint8Array(fs.readFileSync(file));
      item = await importPdf(db, paths, { name, data });
      if (item.status === 'locked' && process.stdin.isTTY) {
        const password = await askHidden(`Password for ${name}: `);
        item = await importPdf(db, paths, { name, data, password });
      }
    } catch (e) {
      // One bad file never stops the rest of the run.
      item = { name, status: 'error', detail: `Could not import this file: ${(e as Error).message}` };
    }
    items.push(item);
    console.log(`${WORD[item.status].padEnd(18)} ${item.name}  ${item.detail}`);
  }
  // Sort the new rows (transfers, card repayments, the rules) like the drop zone does.
  const sorted = sortAfterImport(db, paths, items);
  db.close();
  console.log(`\n${summarise(items)}${sorted}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
