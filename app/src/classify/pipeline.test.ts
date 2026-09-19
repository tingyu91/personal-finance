import { describe, it, expect } from 'vitest';
import { classify, type ClassifyAccount, type ClassifyRow, type DecisionRow, type RuleRow } from './pipeline';
import { DEFAULT_SETTINGS, type Settings } from '../settings';

/** Everything here is invented: ALEX TAN is "self", SAM LEE is the partner. */
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  self: { aliases: ['ALEX TAN', 'Alex Tan DBS', 'AT & SL Joint'] },
  partner: { name: 'Sam', aliases: ['SAM LEE', 'SAM'], refPatterns: ['OCBCSGSGBRT'] },
};

const accounts: ClassifyAccount[] = [
  { id: 1, key: 'deposit:1111:SGD', bank: 'DBS', kind: 'deposit', last4: '1111', owner: 'me', seenOnly: false },
  { id: 2, key: 'deposit:2222:SGD', bank: 'UOB', kind: 'deposit', last4: '2222', owner: 'me', seenOnly: false },
  { id: 3, key: 'deposit:3333:SGD', bank: 'DBS', kind: 'deposit', last4: '3333', owner: 'joint', seenOnly: false },
  { id: 4, key: 'card:4444:SGD', bank: 'UOB', kind: 'card', last4: '4444', owner: 'me', seenOnly: false },
];

let nextId = 1;
function row(accountId: number | null, date: string, amountCents: number, raw: string, extra: Partial<ClassifyRow> = {}): ClassifyRow {
  const id = nextId++;
  return { id, fingerprint: `fp${id}`, accountId, date, amountCents, currency: 'SGD', raw, manual: false, held: false, ...extra };
}

function run(rows: ClassifyRow[], opts: { rules?: RuleRow[]; decisions?: DecisionRow[]; cardAliases?: { last4: string; accountId: number }[] } = {}) {
  const out = classify({ rows, accounts, settings, rules: opts.rules ?? [], decisions: opts.decisions ?? [], cardAliases: opts.cardAliases });
  const byId = new Map(out.results.map((r) => [r.id, r]));
  return { ...out, get: (r: ClassifyRow) => byId.get(r.id)! };
}

const decision = (fingerprint: string, d: Partial<DecisionRow>): DecisionRow => ({ fingerprint, kind: null, category: null, bucket: null, vendor: null, note: null, ...d });
const rule = (id: number, pattern: string, r: Partial<RuleRow>): RuleRow => ({
  id,
  source: 'user',
  priority: 0,
  field: 'payee',
  pattern,
  isRegex: false,
  sign: null,
  accountId: null,
  setKind: null,
  setCategory: null,
  setBucket: null,
  ...r,
});

describe('step 1: refund and reversal pairs', () => {
  it('pairs a same-day reversal and a later refund, and leaves wallet flows alone', () => {
    const debit = row(1, '2026-03-02', -6_842_00, 'Mortgage Loan · ·1234');
    const reversal = row(1, '2026-03-02', 6_842_00, 'Mortgage Loan · ·1234');
    const buy = row(1, '2026-05-01', -36_57, 'FAST Payment / Receipt · PayNow Transfer 1234567 · To: Shoplink Transaction · ABC · Other');
    const back = row(1, '2026-05-06', 36_57, 'FAST Payment / Receipt · SHOPLINKPAYMEabc · ·0000DBSSSGSGBRT0000001 · Refund');
    const topup = row(1, '2026-05-06', -12_40, 'Funds Transfer · TOP-UP TO PAYLAH! : · ALEX TAN · PLPE·0001');
    const maxed = row(1, '2026-05-07', 12_40, 'Funds Transfer · MAXED OUT FROM PAYLAH! : · Robin · TF·0001');
    const r = run([debit, reversal, buy, back, topup, maxed]);
    expect(r.get(debit)).toMatchObject({ kind: 'refund', pairFingerprint: reversal.fingerprint });
    expect(r.get(reversal)).toMatchObject({ kind: 'refund', pairFingerprint: debit.fingerprint });
    expect(r.get(buy)).toMatchObject({ kind: 'refund', pairFingerprint: back.fingerprint });
    expect(r.get(topup).kind).toBe('wallet-topup');
    expect(r.get(maxed).kind).toBe('transfer');
  });

  it('never mistakes money out to yourself and back for a refund', () => {
    const out = row(2, '2026-05-20', -6_150_00, 'Funds Trf - FAST · PIB·0001 · Alex Tan DBS · OTHR Transfer');
    const back = row(2, '2026-05-30', 6_150_00, 'Inward Credit-FAST · OTHR Other · ALEX TAN · Transfer');
    const r = run([out, back]);
    expect(r.get(out).kind).toBe('transfer');
    expect(r.get(back).kind).toBe('transfer');
    expect(r.get(out).classifiedBy).not.toBe('refund-pair');
  });

  it('needs refund evidence: two unrelated payments to the same shop are not a refund', () => {
    const a = row(1, '2026-05-01', -84_20, 'FAST Payment / Receipt · PayNow Transfer 1234567 · To: EXAMPLE STORE · Other');
    const b = row(1, '2026-05-09', 84_20, 'FAST Payment / Receipt · Incoming PayNow Ref 0000001 · From: EXAMPLE STORE OWNER · Other');
    expect(run([a, b]).get(a).kind).not.toBe('refund');
  });

  it('pairs a waived card fee with the fee', () => {
    const fee = row(4, '2026-02-28', -188_45, 'ANNUAL RENEWAL FEE - INCL OF GST');
    const waived = row(4, '2026-03-02', 188_45, 'CR ANNUAL RENEWAL FEE - INCL OF GST');
    const r = run([fee, waived]);
    expect(r.get(fee).kind).toBe('refund');
    expect(r.get(waived).kind).toBe('refund');
  });

  it('never pairs a row from a statement that does not reconcile', () => {
    const debit = row(1, '2026-03-02', -700_00, 'Mortgage Loan · ·1234', { held: true });
    const reversal = row(1, '2026-03-02', 700_00, 'Mortgage Loan · ·1234');
    expect(run([debit, reversal]).get(reversal).kind).not.toBe('refund');
  });
});

describe('step 2: own-account transfers', () => {
  it('pairs an outflow and an inflow between your accounts', () => {
    const out = row(1, '2026-03-10', -9_000_00, 'FAST Payment / Receipt · UOB:·2222:I-BANK · Transfer · ·5678 · Other');
    const inn = row(2, '2026-03-11', 9_000_00, 'Inward Credit-FAST · OTHR Other · ALEX TAN · Transfer');
    const r = run([out, inn]);
    expect(r.get(out)).toMatchObject({ kind: 'transfer', pairFingerprint: inn.fingerprint, target: { accountId: 2 } });
    expect(r.get(inn)).toMatchObject({ kind: 'transfer', pairFingerprint: out.fingerprint, target: { accountId: 1 } });
  });

  it('pairs across a weekend when one bank books the receipt before the other books the debit', () => {
    const out = row(2, '2026-06-02', -4_250_00, 'Funds Trf - FAST · PIB·1234 · Alex Tan DBS · OTHR Transfer');
    const inn = row(1, '2026-05-30', 4_250_00, 'FAST Payment / Receipt · Transfer · ·0000UOVBSGSGBRT0000001 · Other');
    expect(run([out, inn]).get(out)).toMatchObject({ kind: 'transfer', pairFingerprint: inn.fingerprint });
  });

  it('does not pair unrelated payments that happen to match', () => {
    const out = row(1, '2026-03-10', -57_30, 'FAST Payment / Receipt · PayNow Transfer 1234567 · To: JOHN DOE · PayNow Transfer · Other');
    const inn = row(2, '2026-03-10', 57_30, 'FAST Payment / Receipt · Incoming PayNow Ref 0000001 · From: MARY LIM · Other');
    const r = run([out, inn]);
    expect(r.get(out).kind).not.toBe('transfer');
    expect(r.get(inn).kind).not.toBe('transfer');
  });

  it('does not pair a payment to a company with a transfer from you that happens to match', () => {
    const reno = row(1, '2026-04-01', -5_000_00, 'PAYNOW-FAST · EXAMPLE RENO PTE. LTD · MBK·0001');
    const tt = row(2, '2026-04-02', 5_000_00, 'INWARD TRF - TT · 0IR·1234C00 · 0000OI0000000 · ALEX TAN');
    const r = run([reno, tt]);
    expect(r.get(reno).kind).toBe('unclassified');
    expect(r.get(tt)).toMatchObject({ kind: 'transfer', classifiedBy: 'self-alias', pairFingerprint: null });
  });

  it('never pairs a partner’s contribution as your own transfer', () => {
    const out = row(1, '2026-04-01', -1_735_00, 'Funds Transfer · FT0000MB·0001 · ·0001:IB');
    const fromPartner = row(3, '2026-04-01', 1_735_00, 'Advice FAST Payment / Receipt · LUMEN LIGHTING · ·0101OCBCSGSGBRT7000001 · OTHER');
    expect(run([out, fromPartner]).get(fromPartner).kind).toBe('partner-contribution');
  });

  it('never pairs amounts in different currencies', () => {
    const out = row(1, '2026-03-10', -100_00, 'FAST Payment / Receipt · UOB:·2222:I-BANK · Transfer', { currency: 'USD' });
    const inn = row(2, '2026-03-10', 100_00, 'Inward Credit-FAST · OTHR Other · ALEX TAN · Transfer');
    expect(run([out, inn]).get(out).pairFingerprint).toBeNull();
  });

  it('never pairs a broker move as an own transfer', () => {
    const toBroker = row(2, '2026-04-01', -2_000_00, 'Inward Debit-FAST · COLL ·1234Wc · STASHAWAY PTE. LTD. · abc');
    const fromBroker = row(1, '2026-04-02', 2_000_00, 'FAST Payment / Receipt · STASHAWAY WITHDRAWAL · ·0000DBSSSGSGBRT0000001 · Supplier Payment');
    const r = run([toBroker, fromBroker]);
    expect(r.get(toBroker)).toMatchObject({ kind: 'investment', pairFingerprint: null });
    expect(r.get(fromBroker).kind).toBe('investment');
  });
});

describe('step 3: card repayments', () => {
  it('pairs the bank side and the card side by last four, amount and date', () => {
    const bank = row(3, '2026-08-20', -312_45, 'Advice Bill Payment · CCC - ·4444 : I-BANK · REF: ·3456');
    const card = row(4, '2026-08-20', 312_45, 'DBS Visa Direct');
    const r = run([bank, card]);
    expect(r.get(bank)).toMatchObject({ kind: 'card-repayment', pairFingerprint: card.fingerprint, target: { accountId: 4 } });
    expect(r.get(card)).toMatchObject({ kind: 'card-repayment', pairFingerprint: bank.fingerprint });
  });

  it('finds the main card when a bill names a supplementary card', () => {
    const bank = row(3, '2026-08-20', -45_00, 'Advice Bill Payment · CCC - ·5555 : I-BANK · REF: ·3456');
    const r = run([bank], { cardAliases: [{ last4: '5555', accountId: 4 }] });
    expect(r.get(bank)).toMatchObject({ kind: 'card-repayment', target: { accountId: 4 } });
    expect(r.newAccounts).toEqual([]);
  });

  it('creates a card seen only as a repayment target, once, with the issuer when known', () => {
    const a = row(3, '2026-06-22', -1_140_00, 'Advice Bill Payment · AMEX-·7101 : I-BANK · REF: ·7111');
    const b = row(2, '2026-07-09', -3_411_27, 'Bill Payment · mBK-AMEX · ·7101');
    const c = row(3, '2026-07-01', -2_000_00, 'Advice Bill Payment · CCC - ·7102 : I-BANK · REF: ·1');
    const d = row(2, '2026-07-03', -20_000_00, 'Bill Payment · mBK-Citi CC · ·7102');
    const r = run([a, b, c, d]);
    expect(r.newAccounts).toEqual([
      { key: 'card:7101:SGD', bank: 'Amex', product: 'Card', kind: 'card', last4: '7101' },
      { key: 'card:7102:SGD', bank: 'Citi', product: 'Card', kind: 'card', last4: '7102' },
    ]);
    expect(r.get(a)).toMatchObject({ kind: 'card-repayment', target: { newKey: 'card:7101:SGD' } });
    expect(r.get(c)).toMatchObject({ kind: 'card-repayment', target: { newKey: 'card:7102:SGD' } });
  });
});

describe('investments and wallets', () => {
  it('recognises brokers either way, wallet top-ups and wallet overflow', () => {
    const ibkr = row(2, '2026-04-01', -173_00, 'Inward Debit-FAST · OTHR U·1234.5678 · Interactive Brokers · U·1234');
    const paylah = row(1, '2026-04-01', -8_50, 'Funds Transfer · TOP-UP TO PAYLAH! : · ALEX TAN · PLPE·0001');
    const wise = row(2, '2026-04-01', -250_00, 'PAYNOW-FAST · PIB·7104 · WISE ASIA-PACIFIC PT · OTHR P·7112QR');
    const r = run([ibkr, paylah, wise]);
    expect(r.get(ibkr).kind).toBe('investment');
    expect(r.get(paylah)).toMatchObject({ kind: 'wallet-topup', payee: 'PayLah top-up' });
    expect(r.get(wise).kind).toBe('wallet-topup');
  });
});

describe('partner contributions', () => {
  it('reads a partner reference pattern only on the joint account, and names anywhere', () => {
    const joint = row(3, '2026-08-19', 1_735_00, 'Advice FAST Payment / Receipt · LUMEN LIGHTING · ·0101OCBCSGSGBRT7000001 · OTHER');
    const notJoint = row(1, '2026-08-19', 1_735_00, 'FAST Payment / Receipt · LUMEN · ·0101OCBCSGSGBRT7000002 · Other');
    const named = row(1, '2026-08-20', 2_975_00, 'FAST Payment / Receipt · Incoming PayNow Ref 0000001 · From: SAM LEE · Sofa · Other');
    const r = run([joint, notJoint, named]);
    expect(r.get(joint)).toMatchObject({ kind: 'partner-contribution', payee: 'Lumen Lighting' });
    expect(r.get(notJoint).kind).toBe('unclassified');
    expect(r.get(named).kind).toBe('partner-contribution');
  });
});

describe('your own name on the other side', () => {
  it('treats money from or to you as a transfer even without the other statement', () => {
    const tt = row(2, '2026-05-02', 4_150_00, 'INWARD TRF - TT · 0IR·1234C00 · 0000OI0000000 · ALEX TAN');
    const vendor = row(2, '2026-05-02', -371_00, 'PAYNOW-FAST · PIB·1234 · EXAMPLE ACADEMY · OTHR ALEX TAN ·1234');
    const r = run([tt, vendor]);
    expect(r.get(tt)).toMatchObject({ kind: 'transfer', classifiedBy: 'self-alias' });
    expect(r.get(vendor).kind).toBe('unclassified');
  });
});

describe('your rules, then seeded rules', () => {
  it('applies your payee rule before a seed', () => {
    const bus = row(4, '2026-07-21', -6_13, 'BUS/MRT ·7113 SINGAPORE');
    const abc = row(2, '2026-07-20', -1_140_00, 'PAYNOW-FAST · ABC LTD · MBK·7105');
    const r = run([bus, abc], { rules: [rule(7, 'ABC', { setKind: 'spend', setCategory: 'Family & giving' })] });
    expect(r.get(bus)).toMatchObject({ kind: 'spend', category: 'Transport', payee: 'Bus/MRT', needsReview: false, classifiedBy: 'seed:transport' });
    expect(r.get(abc)).toMatchObject({ kind: 'spend', category: 'Family & giving', classifiedBy: 'rule:7', needsReview: false });
  });

  it('matches your rule on the name you see, even when a seed renamed it', () => {
    const ptax = row(2, '2026-07-06', -689_40, 'Inward DR - GIRO · PTXP [NRIC] · IRAS · ·6114N');
    const r = run([ptax], { rules: [rule(8, 'IRAS property tax', { setKind: 'spend', setCategory: 'Home project', setBucket: 'running' })] });
    expect(r.get(ptax)).toMatchObject({ classifiedBy: 'rule:8', category: 'Home project', bucket: 'running', payee: 'IRAS property tax' });
  });

  it('lets your rule win over the automatic wallet step', () => {
    const topup = row(1, '2026-04-01', -8_50, 'Funds Transfer · TOP-UP TO PAYLAH! : · ALEX TAN · PLPE·0001');
    const r = run([topup], { rules: [rule(9, 'PayLah top-up', { setKind: 'spend', setCategory: 'Food & groceries' })] });
    expect(r.get(topup)).toMatchObject({ kind: 'spend', category: 'Food & groceries', classifiedBy: 'rule:9' });
  });

  it('lets your rule win over own-transfer pairing', () => {
    const pay = row(1, '2026-06-05', -2_468_00, 'FAST Payment / Receipt · EXAMPLE BUILDERS · ·0000DBSSSGSGBRT0000001 · Other');
    const unrelated = row(2, '2026-06-06', 2_468_00, 'FAST Payment / Receipt · Transfer · ·0000UOVBSGSGBRT0000001 · Other');
    // Two bank-coded FAST payments of the same amount would pair as a transfer on their own.
    expect(run([pay, unrelated]).get(pay).kind).toBe('transfer');
    const r = run([pay, unrelated], { rules: [rule(12, 'Example Builders', { setKind: 'spend', setCategory: 'Home project', setBucket: 'renovation' })] });
    expect(r.get(pay)).toMatchObject({ kind: 'spend', category: 'Home project', bucket: 'renovation', classifiedBy: 'rule:12', pairFingerprint: null });
    expect(r.get(unrelated)).toMatchObject({ kind: 'unclassified', needsReview: true, pairFingerprint: null });
  });

  it('infers the kind of an older rule from its category, and ignores a rule with neither', () => {
    const a = row(2, '2026-07-20', -1_140_00, 'PAYNOW-FAST · ABC LTD · MBK·7105');
    const b = row(2, '2026-07-21', 2_00, 'PAYNOW-FAST · ABC LTD · MBK·7106');
    const r = run([a, b], { rules: [rule(10, 'ABC', { setCategory: 'Transport' })] });
    expect(r.get(a)).toMatchObject({ kind: 'spend', category: 'Transport' });
    const r2 = run([row(2, '2026-07-20', 5_00, 'PAYNOW-FAST · ABC LTD · MBK·7105')], { rules: [rule(11, 'ABC', {})] });
    expect(r2.results[0]!.classifiedBy).not.toBe('rule:11');
    void b;
  });

  it('knows salary, income tax, property tax and card fees', () => {
    const sal = row(2, '2026-07-16', 8_400_00, 'Inward CR - GIRO · SALA Salary Payment · EXAMPLE EMPLOYER PTE. · ·7107P00XXX');
    const tax = row(2, '2026-07-06', -900_00, 'Inward DR - GIRO · TAXS [NRIC] · IRAS · Income Tax');
    const ptax = row(2, '2026-07-06', -689_40, 'Inward DR - GIRO · PTXP [NRIC] · IRAS · ·6114N');
    const fee = row(4, '2026-07-01', -188_45, 'CARD MEMBERSHIP FEE -INCLUSIVE OF GST');
    const r = run([sal, tax, ptax, fee]);
    expect(r.get(sal)).toMatchObject({ kind: 'income', category: 'Salary', payee: 'Example Employer' });
    expect(r.get(tax)).toMatchObject({ kind: 'tax', payee: 'IRAS income tax' });
    expect(r.get(ptax)).toMatchObject({ kind: 'spend', category: 'Home running' });
    expect(r.get(fee).kind).toBe('fee');
  });

  it('does not turn a bank-account inflow into spending', () => {
    const inn = row(1, '2026-07-02', 43_00, 'FAST Payment / Receipt · Incoming PayNow Ref 0000001 · From: KOPITIAM FRIEND · Other');
    expect(run([inn]).get(inn).kind).toBe('unclassified');
  });
});

describe('defaults and the Review queue', () => {
  it('counts card purchases and card-terminal payments as spending to check, and keeps everything else out of spending', () => {
    const card = row(4, '2026-07-02', -13_27, 'SMP_EXAMPLE PTE LTD SINGAPORE');
    const nets = row(1, '2026-07-02', -6_10, 'Debit Card Transaction · EXAMPLESHOP 12 SGP 12APR · ·1234 · ·5678');
    const company = row(1, '2026-07-02', -162_00, 'Advice FAST Payment / Receipt · PAYNOW TRANSFER 1234567 · TO: EXAMPLE ENGINEERING PTE. LTD. · OTHER');
    const person = row(1, '2026-07-02', -57_30, 'Advice FAST Payment / Receipt · PAYNOW TRANSFER 1234567 · TO: JOHN DOE · PAYNOW TRANSFER · OTHER');
    const inflow = row(1, '2026-07-03', 500_00, 'FAST Payment / Receipt · Incoming PayNow Ref 0000001 · From: MARY LIM · Washer · Other');
    const cardCredit = row(4, '2026-07-04', 20_00, 'UNKNOWN CREDIT');
    const r = run([card, nets, company, person, inflow, cardCredit]);
    expect(r.get(card)).toMatchObject({ kind: 'spend', category: 'Other', needsReview: true });
    expect(r.get(nets)).toMatchObject({ kind: 'spend', needsReview: true });
    for (const x of [company, person, inflow, cardCredit]) expect(r.get(x)).toMatchObject({ kind: 'unclassified', category: null, needsReview: true });
  });
});

describe('decisions', () => {
  it('override everything and clear Review', () => {
    const person = row(1, '2026-07-02', -57_30, 'Advice FAST Payment / Receipt · PAYNOW TRANSFER 1234567 · TO: JOHN DOE · PAYNOW TRANSFER · OTHER');
    const bus = row(4, '2026-07-21', -6_13, 'BUS/MRT ·7113 SINGAPORE');
    const r = run([person, bus], {
      decisions: [
        decision(person.fingerprint, { kind: 'spend', category: 'Family & giving', note: 'Birthday' }),
        decision(bus.fingerprint, { category: 'Travel & leisure' }),
      ],
    });
    expect(r.get(person)).toMatchObject({ kind: 'spend', category: 'Family & giving', note: 'Birthday', needsReview: false, classifiedBy: 'decision' });
    expect(r.get(bus)).toMatchObject({ kind: 'spend', category: 'Travel & leisure', needsReview: false, payee: 'Bus/MRT' });
  });

  it('reads an income category as income, never as negative spending', () => {
    const inn = row(1, '2026-07-02', 500_00, 'FAST Payment / Receipt · Incoming PayNow Ref 0000001 · From: MARY LIM · Other');
    expect(run([inn], { decisions: [decision(inn.fingerprint, { category: 'Other income' })] }).get(inn)).toMatchObject({ kind: 'income', category: 'Other income' });
  });

  it('frees the other side of a pair you have changed', () => {
    const out = row(1, '2026-03-10', -9_000_00, 'FAST Payment / Receipt · UOB:·2222:I-BANK · Transfer · ·5678 · Other');
    const inn = row(2, '2026-03-11', 9_000_00, 'Inward Credit-FAST · OTHR Other · ALEX TAN · Transfer');
    const r = run([out, inn], { decisions: [decision(out.fingerprint, { kind: 'spend', category: 'Other' })] });
    expect(r.get(out)).toMatchObject({ kind: 'spend', pairFingerprint: null });
    expect(r.get(inn)).toMatchObject({ kind: 'transfer', classifiedBy: 'self-alias', pairFingerprint: null });
  });

  it('keeps a row in Review when you only added a note', () => {
    const person = row(1, '2026-07-02', -57_30, 'Advice FAST Payment / Receipt · PAYNOW TRANSFER 1234567 · TO: JOHN DOE · OTHER');
    expect(run([person], { decisions: [decision(person.fingerprint, { note: 'Ask John' })] }).get(person)).toMatchObject({ kind: 'unclassified', needsReview: true, note: 'Ask John' });
  });

  it('settles manual entries by their decision and leaves the rest alone', () => {
    const withDecision = row(null, '2026-02-10', -500_00, 'Manual entry', { manual: true });
    const without = row(null, '2026-02-11', -100_00, 'Manual entry', { manual: true });
    const r = run([withDecision, without], { decisions: [decision(withDecision.fingerprint, { kind: 'spend', category: 'Home project', bucket: 'renovation' })] });
    expect(r.get(withDecision)).toMatchObject({ kind: 'spend', category: 'Home project', bucket: 'renovation' });
    expect(r.results.find((x) => x.id === without.id)).toBeUndefined();
  });
});
