import { describe, it, expect } from 'vitest';
import { extractPdf, groupLines, PdfPasswordError, type PdfLoader } from './extract';

const item = (str: string, x: number, y: number, w: number) => ({ str, x, y, w, r: x + w });

describe('groupLines', () => {
  it('groups items into lines top to bottom, left to right, dropping blanks', () => {
    const lines = groupLines([
      item('1,234.56', 360, 137.4, 35),
      item('20/08/2026', 45, 137, 40),
      item('Advice Bill Payment', 113, 137.2, 70),
      item('CCC', 113, 127, 15),
      item(' ', 200, 127, 2),
    ]);
    expect(lines.map((l) => l.text)).toEqual(['20/08/2026 Advice Bill Payment 1,234.56', 'CCC']);
    expect(lines[0]!.items.map((i) => i.x)).toEqual([45, 113, 360]);
  });

  it('keeps lines 3pt apart separate', () => {
    const lines = groupLines([item('a', 10, 100, 5), item('b', 10, 97, 5)]);
    expect(lines).toHaveLength(2);
  });

  it('trims item text', () => {
    const lines = groupLines([item('  Total ', 97, 375, 20)]);
    expect(lines[0]!.items[0]!.str).toBe('Total');
  });
});

describe('extractPdf', () => {
  const failing = (e: unknown): PdfLoader => async () => {
    throw e;
  };

  it('maps a missing password to PdfPasswordError("needed")', async () => {
    const err = await extractPdf(new Uint8Array([1]), undefined, failing({ name: 'PasswordException', code: 1 })).catch((e) => e);
    expect(err).toBeInstanceOf(PdfPasswordError);
    expect(err.reason).toBe('needed');
  });

  it('maps a wrong password to PdfPasswordError("incorrect")', async () => {
    const err = await extractPdf(new Uint8Array([1]), 'nope', failing({ name: 'PasswordException', code: 2 })).catch((e) => e);
    expect(err.reason).toBe('incorrect');
    expect(String(err.message)).not.toContain('nope');
  });

  it('does not detach the caller’s buffer', async () => {
    const data = new Uint8Array([1, 2, 3]);
    let seen: Uint8Array | null = null;
    const loader: PdfLoader = async (opts) => {
      seen = opts.data;
      return { numPages: 0, getPage: async () => { throw new Error('none'); } };
    };
    await extractPdf(data, undefined, loader);
    expect(seen).not.toBe(data);
    expect(data.length).toBe(3);
  });
});
