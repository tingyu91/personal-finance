import { describe, it, expect } from 'vitest';
import { ADAPTERS, detectAdapter } from './index';
import { docText } from './kit';
import { doc, line, page, at } from '../../test/fixtures/pdf';
import { dbsConsolidated } from '../../test/fixtures/synthetic/dbs-consolidated';
import { dbsSavings } from '../../test/fixtures/synthetic/dbs-savings';
import { uobOne } from '../../test/fixtures/synthetic/uob-one';
import { uobCard } from '../../test/fixtures/synthetic/uob-card';

const fixtures = {
  'dbs-consolidated': dbsConsolidated,
  'dbs-savings': dbsSavings,
  'uob-deposit': uobOne,
  'uob-card': uobCard,
};

describe('adapter registry', () => {
  it('has unique ids', () => {
    const ids = ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const [id, fixture] of Object.entries(fixtures)) {
    it(`detects ${id} by its own adapter only`, () => {
      expect(detectAdapter(fixture)?.adapter.id).toBe(id);
      const claiming = ADAPTERS.filter((a) => a.detect(docText(fixture)) >= 0.5).map((a) => a.id);
      expect(claiming).toEqual([id]);
    });
  }

  it('returns null for a layout nobody knows', () => {
    const other = doc(page(1, line(700, at(40, 'Monthly statement')), line(680, at(40, 'OCBC 360 Account'))));
    expect(detectAdapter(other)).toBeNull();
  });
});
