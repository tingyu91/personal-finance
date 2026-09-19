import type { PdfDoc, PdfItem, PdfLine } from '../adapters/types';

export type { PdfDoc, PdfItem, PdfLine, PdfPage } from '../adapters/types';

/** The PDF asks for a password. The password itself never appears in the message. */
export class PdfPasswordError extends Error {
  constructor(readonly reason: 'needed' | 'incorrect') {
    super(reason === 'needed' ? 'This PDF needs its password' : 'That password did not open this PDF');
    this.name = 'PdfPasswordError';
  }
}

interface TextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
}

interface PageLike {
  getTextContent(): Promise<{ items: TextItemLike[] }>;
  cleanup?(): void;
}

interface DocLike {
  numPages: number;
  getPage(n: number): Promise<PageLike>;
  destroy?(): Promise<void>;
}

export type PdfLoader = (opts: { data: Uint8Array; password?: string }) => Promise<DocLike>;

const LINE_TOLERANCE = 2;

/** Items into lines: top to bottom (pdf y grows upwards), then left to right. */
export function groupLines(items: PdfItem[], tolerance = LINE_TOLERANCE): PdfLine[] {
  const clean = items
    .map((i) => ({ ...i, str: i.str.trim() }))
    .filter((i) => i.str !== '')
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfLine[] = [];
  for (const it of clean) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tolerance);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it], text: '' });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str).join(' ');
  }
  return lines.sort((a, b) => b.y - a.y);
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfjsModule> | null = null;

/**
 * pdf.js prints canvas-polyfill and getBuiltinModule warnings on import under Node 20.11;
 * text extraction needs neither, so those two messages are dropped.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjs) {
    const warn = console.warn;
    const log = console.log;
    const quiet =
      (orig: (...a: unknown[]) => void) =>
      (...args: unknown[]) => {
        if (typeof args[0] === 'string' && /Cannot polyfill|getBuiltinModule/.test(args[0])) return;
        orig(...args);
      };
    console.warn = quiet(warn);
    console.log = quiet(log);
    pdfjs = import('pdfjs-dist/legacy/build/pdf.mjs')
      .catch((e) => {
        pdfjs = null; // let the next import try again instead of caching the failure
        throw e;
      })
      .finally(() => {
        console.warn = warn;
        console.log = log;
      });
  }
  return pdfjs;
}

const defaultLoader: PdfLoader = async ({ data, password }) => {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data,
    password,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  return (await task.promise) as unknown as DocLike;
};

function isPasswordException(e: unknown): e is { name: string; code: number } {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PasswordException';
}

/**
 * Reads every page's text with positions. The caller's buffer is copied first because pdf.js
 * transfers (detaches) the one it is given. A password is used for this call only.
 */
export async function extractPdf(data: Uint8Array, password?: string, loader: PdfLoader = defaultLoader): Promise<PdfDoc> {
  let doc: DocLike;
  try {
    doc = await loader({ data: new Uint8Array(data), password });
  } catch (e) {
    if (isPasswordException(e)) throw new PdfPasswordError(e.code === 2 ? 'incorrect' : 'needed');
    throw e;
  }
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of content.items) {
        if (typeof it.str !== 'string' || !it.transform) continue;
        const x = it.transform[4] ?? 0;
        const y = it.transform[5] ?? 0;
        const w = it.width ?? 0;
        items.push({ str: it.str, x, y, w, r: x + w });
      }
      pages.push({ number: n, lines: groupLines(items) });
      page.cleanup?.();
    }
    return { pages };
  } finally {
    await doc.destroy?.();
  }
}
