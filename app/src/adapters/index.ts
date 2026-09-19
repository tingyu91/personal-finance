import { dbsConsolidatedAdapter } from './dbs-consolidated';
import { dbsSavingsAdapter } from './dbs-savings';
import { docText } from './kit';
import { uobCardAdapter } from './uob-card';
import { uobOneAdapter } from './uob-one';
import type { Adapter, PdfDoc } from './types';

/** Every statement layout Tally can read. Add one adapter per new layout (test first). */
export const ADAPTERS: Adapter[] = [dbsConsolidatedAdapter, dbsSavingsAdapter, uobOneAdapter, uobCardAdapter];

const MIN_CONFIDENCE = 0.5;

/** The most confident adapter for a document, or null when none is at least 0.5 sure. */
export function detectAdapter(doc: PdfDoc): { adapter: Adapter; confidence: number } | null {
  const text = docText(doc);
  let best: { adapter: Adapter; confidence: number } | null = null;
  for (const adapter of ADAPTERS) {
    const confidence = adapter.detect(text);
    if (confidence >= MIN_CONFIDENCE && (!best || confidence > best.confidence)) best = { adapter, confidence };
  }
  return best;
}
