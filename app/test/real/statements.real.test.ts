import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractPdf } from '../../src/pdf/extract';
import { ADAPTERS, detectAdapter } from '../../src/adapters';
import { docText } from '../../src/adapters/kit';
import { reconcile } from '../../src/reconcile';
import { hasRealStatements, realPdfs } from './inbox';

/**
 * Reconciliation against the real statements (PRD §4.2): every file is recognised by exactly
 * one adapter and every statement it yields matches its own printed figures to the cent.
 * Failure messages name the file and the check, never a transaction.
 */
describe.skipIf(!hasRealStatements)('real statements', () => {
  for (const file of realPdfs()) {
    const name = path.basename(file);
    it(`${name} is recognised and reconciles`, async () => {
      const doc = await extractPdf(new Uint8Array(fs.readFileSync(file)));
      const text = docText(doc);
      const confident = ADAPTERS.filter((a) => a.detect(text) >= 0.5).map((a) => a.id);
      expect(confident, `${name}: adapters claiming it`).toHaveLength(1);
      const hit = detectAdapter(doc)!;
      const statements = hit.adapter.parse(doc);
      expect(statements.length, `${name}: statements parsed`).toBeGreaterThan(0);
      for (const s of statements) {
        const result = reconcile(s);
        const failed = result.checks.filter((c) => !c.ok).map((c) => `${c.name} (expected ${c.expected}, got ${c.actual})`);
        expect(failed, `${name} ${s.account.product} ${s.account.currency}`).toEqual([]);
      }
    });
  }
});
