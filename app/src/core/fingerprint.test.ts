import { describe, it, expect } from 'vitest';
import { assignFingerprints, fingerprint, normaliseRaw } from './fingerprint';

const base = { accountKey: 'deposit:9012:SGD', date: '2026-08-01', amountCents: -800 };

describe('fingerprint', () => {
  it('normalises raw text to letters only', () => {
    expect(normaliseRaw('PayNow  Transfer ·1234 / Other')).toBe('PAYNOWTRANSFEROTHER');
  });

  it('is stable across digit-only changes, case and whitespace', () => {
    const a = fingerprint({ ...base, raw: 'PAYNOW  TRANSFER 123' }, 0);
    const b = fingerprint({ ...base, raw: 'paynow transfer 999' }, 0);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  it('changes with account, date, amount, card and occurrence', () => {
    const a = fingerprint({ ...base, raw: 'X' }, 0);
    expect(fingerprint({ ...base, accountKey: 'deposit:9999:SGD', raw: 'X' }, 0)).not.toBe(a);
    expect(fingerprint({ ...base, date: '2026-08-02', raw: 'X' }, 0)).not.toBe(a);
    expect(fingerprint({ ...base, amountCents: 800, raw: 'X' }, 0)).not.toBe(a);
    expect(fingerprint({ ...base, raw: 'X', cardLast4: '2222' }, 0)).not.toBe(a);
    expect(fingerprint({ ...base, raw: 'X' }, 1)).not.toBe(a);
  });

  it('tells apart identical card charges that post on different days', () => {
    // Same-day twin charges can post either side of a statement date and land in two statements.
    const a = fingerprint({ ...base, raw: 'BUS/MRT', postDate: '2026-08-20' }, 0);
    const b = fingerprint({ ...base, raw: 'BUS/MRT', postDate: '2026-08-21' }, 0);
    expect(a).not.toBe(b);
    expect(fingerprint({ ...base, raw: 'BUS/MRT', postDate: null }, 0)).toBe(fingerprint({ ...base, raw: 'BUS/MRT' }, 0));
  });

  it('separates identical rows by occurrence and matches across overlapping statements', () => {
    const rows = [
      { date: '2026-07-21', amountCents: -613, raw: 'BUS/MRT ·1357 SINGAPORE' },
      { date: '2026-07-21', amountCents: -613, raw: 'BUS/MRT ·2468 SINGAPORE' },
      { date: '2026-07-22', amountCents: -219, raw: 'CHEERS' },
    ];
    const first = assignFingerprints('card:9013:SGD', rows);
    expect(first[0]!.fingerprint).not.toBe(first[1]!.fingerprint);
    const again = assignFingerprints('card:9013:SGD', rows.slice(1));
    expect(again[0]!.fingerprint).toBe(first[0]!.fingerprint);
    expect(again[1]!.fingerprint).toBe(first[2]!.fingerprint);
  });
});
