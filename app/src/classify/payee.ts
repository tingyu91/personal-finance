import type { AccountKind } from '../adapters/types';

/**
 * The cleaned payee shown over the bank's raw line (design system: "Casa Example" over
 * "PAYNOW-FAST · CASA EXAMPLE PTE. L"). Each layout keeps the counterparty on a known line.
 */

const ACRONYMS = new Set(['IRAS', 'DBS', 'UOB', 'OCBC', 'POSB', 'CPF', 'HDB', 'MCST', 'IKEA', 'NTUC', 'AXS', 'SP', 'NETS', 'GV', 'AIA', 'OSIM', 'KFC', 'MRT', 'CDG', 'SGD', 'USD', 'UNI$', 'IBKR', 'M&S', 'TT', 'AT', 'SL']);
const SUFFIX = /[\s,]*(?:PTE\.?\s*LTD\.?|PTE\.?\s*L\.?|PTE\.?|LTD\.?|LIMITED|PRIVATE LIMITED|CO\.?)$/i;
const CARD_TAIL = /\s+(?:SINGAPORE|SINGAPOREQ|Singapore|SG|SGP|N\/A|INTERNET|Stockholm|Amsterdam|Berlin|CORK|London|Dublin|Luxembourg)$/;
const REF_TOKEN = /\s+(?:·\d{4}|[A-Z0-9]*\d[A-Z0-9]*)$/i;

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'DR', 'ST', 'JR', 'SR', 'MDM']);

/** Short words with no vowels are acronyms (TCM, CDG, BGP); honorifics are not. */
function keepUpper(word: string): boolean {
  const w = word.toUpperCase();
  if (ACRONYMS.has(w)) return true;
  const letters = w.replace(/[^A-Z]/g, '');
  return letters.length >= 2 && letters.length <= 4 && !/[AEIOUY]/.test(letters) && !HONORIFICS.has(letters);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/(&*])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
    .split(' ')
    .map((w) => (keepUpper(w) ? w.toUpperCase() : w))
    .join(' ');
}

/** Company suffixes off, trailing "SINGAPORE" off, shouting text title-cased (acronyms kept). */
export function tidyName(s: string): string {
  let out = s.replace(/·\d{4}/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    out = out.replace(SUFFIX, '').trim();
    out = out.replace(/\s+SINGAPORE$/i, '').trim();
  }
  out = out.replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '');
  return /[a-z]/.test(out) ? out : titleCase(out);
}

function cardPayee(first: string): string {
  let s = first.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    s = s.replace(CARD_TAIL, '').replace(REF_TOKEN, '').trim();
  }
  s = s.replace(/SINGAPORE$/, '').trim();
  return tidyName(s) || first;
}

/** UOB reference lines: channel refs and GIRO/FAST purpose codes, never the counterparty. */
const UOB_REF = /^(?:PIB|MBK|IB)·|^·\d{4}|^(?:OTHR|COLL|SUPP|SALA|TAXS|PTXP)\b|^[A-Z]{1,4}·\d{4}/;

const CARD_BILL: [RegExp, string][] = [
  [/CCC - ·(\d{4})/, 'Card'],
  [/AMEX-·(\d{4})/, 'Amex'],
  [/mBK-AMEX · ·(\d{4})/, 'Amex'],
  [/mBK-Citi CC · ·(\d{4})/, 'Citi card'],
  [/mBK-UOB Cards · ·(\d{4})/, 'UOB card'],
];

export function cleanPayee(raw: string, accountKind: AccountKind): string {
  const lines = raw.split(' · ').map((l) => l.trim());
  const first = lines[0] ?? '';
  if (accountKind === 'card') return cardPayee(first);

  for (const [re, label] of CARD_BILL) {
    const m = re.exec(raw);
    if (m) return `${label} ·${m[1]}`;
  }
  const named = lines.map((l) => /^(?:TO|To|FROM|From):\s*(.+)$/.exec(l)?.[1]).find(Boolean);
  if (named) return tidyName(named);

  if (/^Interest (Earned|Credit)$/i.test(first)) return 'Interest';
  if (/^Mortgage Loan$/i.test(first)) return 'Mortgage loan';
  if (/^Insurance$/i.test(first)) return 'Insurance';
  if (/^Quick Cheque Deposit$/i.test(first)) return 'Cheque deposit';
  if (/Telegraphic Transfer Comm/i.test(first)) return 'Telegraphic transfer charges';
  if (/Telegraphic Transfer$/i.test(first)) return 'Telegraphic transfer';
  if (/^Misc Debit$/i.test(first) && /DR CO CHARGES/.test(raw)) return 'Cashier’s order';

  if (/^Funds Transfer$/i.test(first) || /^Advice Funds Transfer$/i.test(first)) {
    if (/TOP-UP TO PAYLAH/i.test(raw)) return 'PayLah top-up';
    if (/MAXED OUT FROM PAYLAH/i.test(raw)) return 'PayLah';
    const ib = lines.map((l) => /^IB:(.+)$/.exec(l)?.[1]).find(Boolean);
    return ib ? tidyName(ib) : 'Funds transfer';
  }
  if (/^(PAYNOW-FAST|Funds Trf - FAST|Inward CR - GIRO|Inward DR - GIRO|Inward Credit-FAST|Inward Debit-FAST)$/i.test(first)) {
    // Internet banking puts a reference first (PIB·…), mobile banking puts the name first (… · MBK·…).
    const name = lines.slice(1).find((l) => !UOB_REF.test(l));
    return tidyName(name ?? first);
  }
  if (/^INWARD TRF - TT/i.test(first)) return tidyName(lines.at(-1) ?? first);
  if (/Point-Of-Sale Transaction|Purchase with Cash Withdrawal/i.test(first)) {
    const m = /^·\d{4},(.+)$/.exec(lines[1] ?? '');
    if (m) return tidyName(m[1]!.replace(/\s+#\d+-\d+$/, ''));
  }
  if (/^Debit Card Transaction$/i.test(first)) {
    return tidyName((lines[1] ?? '').replace(/\s+\d*\s*SGP\s+\d{2}[A-Z]{3}$/i, ''));
  }
  if (/^(Misc DR-Debit Card)$/i.test(first)) return tidyName(lines[2] ?? first);
  if (/^NETS Debit-Consumer$/i.test(first)) return tidyName((lines[1] ?? '').replace(/·\d{4}$/, ''));
  if (/^Advice$/i.test(first)) return tidyName(lines.at(-1) ?? first);

  if (/FAST Payment \/ Receipt$/i.test(first)) {
    const purpose = lines.slice(1).find((l) => !/^(PAYNOW TRANSFER|PayNow Transfer|Incoming PayNow Ref)\b/.test(l)) ?? '';
    const bankAcct = /^([A-Z]{3,5}):·\d{4}:I-BANK$/.exec(purpose);
    if (bankAcct) return `${bankAcct[1]} account`;
    return tidyName(purpose) || 'FAST transfer';
  }
  return tidyName(lines[1] ?? first) || first;
}
