import { describe, it, expect } from 'vitest';
import { cleanPayee, tidyName } from './payee';

describe('cleanPayee', () => {
  const deposit: [string, string][] = [
    ['Advice FAST Payment / Receipt · PAYNOW TRANSFER 1234567 · TO: EXAMPLE STUDIO PTE. LTD. · ALEX TAN · OTHER', 'Example Studio'],
    ['FAST Payment / Receipt · Incoming PayNow Ref 0000001 · From: JOHN DOE · Other', 'John Doe'],
    ['Advice FAST Payment / Receipt · SAM HOUSEHOLD AUG · ·0001OCBCSGSGBRT7000001 · OTHER', 'Sam Household Aug'],
    ['FAST Payment / Receipt · UOB:·1234:I-BANK · Transfer · ·5678 · Other', 'UOB account'],
    ['Advice Bill Payment · CCC - ·1111 : I-BANK · REF: ·3456', 'Card ·1111'],
    ['Advice Bill Payment · AMEX-·7101 : I-BANK · REF: ·3456', 'Amex ·7101'],
    ['Bill Payment · mBK-Citi CC · ·7102', 'Citi card ·7102'],
    ['Bill Payment · mBK-UOB Cards · ·7103', 'UOB card ·7103'],
    ['Funds Transfer · TOP-UP TO PAYLAH! : · ALEX TAN · PLPE·0001', 'PayLah top-up'],
    ['Funds Transfer · MAXED OUT FROM PAYLAH! : · Northpoint · TF·0001', 'PayLah'],
    ['Funds Transfer · FT0000MB·1234 · IB:JOHN DOE · Good Faith Deposit', 'John Doe'],
    ['Funds Transfer · FT0000MB·1234 · ·1234:IB', 'Funds transfer'],
    ['PAYNOW-FAST · PIB·7104 · EXAMPLE PAINT PTE. LTD · OTHR 123', 'Example Paint'],
    ['PAYNOW-FAST · EXAMPLE STUDIO PTE. L · MBK·7105', 'Example Studio'],
    ['Inward Debit-FAST · COLL ·1234Wc · EXAMPLE INVEST PTE. LTD. · 0a1b2c', 'Example Invest'],
    ['Funds Trf - FAST · PIB·7106 · AT & SL Joint · OTHR Transfer', 'AT & SL Joint'],
    ['Inward CR - GIRO · SALA Salary Payment · EXAMPLE EMPLOYER PTE. · ·7107P00XXX', 'Example Employer'],
    ['Inward DR - GIRO · TAXS [NRIC] · IRAS · Income Tax', 'IRAS'],
    ['Inward Debit-FAST · OTHR U·1234.5678 · Example Brokers · U·1234', 'Example Brokers'],
    ['INWARD TRF - TT · 0IR·1234C00 · 0000OI0000000 · ALEX TAN', 'Alex Tan'],
    ['Misc Debit · DR CO CHARGES · CO-·1234', 'Cashier’s order'],
    ['Advice Point-Of-Sale Transaction or Proceeds · NETS QR PAYMENT ·1234 · TO: MR EXAMPLE', 'Mr Example'],
    ['Point-of-Sale Transaction · ·1234,EXAMPLE TEA SINGAPORE PTE LTD', 'Example Tea'],
    ['Purchase with Cash Withdrawal · ·7108,7-ELEVEN-EXAMPLE #01-01 · PURCH 3.90, CSHBACK 100.00', '7-Eleven-Example'],
    ['Debit Card Transaction · PAYPAL *EXAMPLESHOP 12 SGP 12APR · ·1234 · ·5678', 'Paypal *Exampleshop'],
    ['Payments / Collections via GIRO · Example Insurance-Operations · INS ·2026 · ·7109', 'Example Insurance-Operations'],
    ['NETS Debit-Consumer · EXAMPLE NOODLE·1234 · xxxxxx1234', 'Example Noodle'],
    ['Interest Earned', 'Interest'],
    ['Interest Credit', 'Interest'],
    ['Mortgage Loan · ·1234', 'Mortgage loan'],
    ['Quick Cheque Deposit', 'Cheque deposit'],
    ['Advice · 0000 FT0000WP·1234 · VAL FEE', 'Val Fee'],
    ['Outward Telegraphic Transfer · MB·1234 · 0000OT0000000', 'Telegraphic transfer'],
  ];
  for (const [raw, payee] of deposit) {
    it(`deposit: ${payee}`, () => expect(cleanPayee(raw, 'deposit')).toBe(payee));
  }

  const card: [string, string][] = [
    ['EXAMPLE MART-WEST MALL Singapore', 'Example Mart-West Mall'],
    ['Spotify P000A00A00 Stockholm', 'Spotify'],
    ['McDonalds 000001 Singapore', 'McDonalds'],
    ['APPLE.COM/BILL ·7110', 'Apple.com/Bill'],
    ['EXAMPLE SOUP UN - METROSINGAPORE', 'Example Soup Un - Metro'],
    ['IKEA SINGAPORE', 'IKEA'],
    ['DBS Visa Direct', 'DBS Visa Direct'],
  ];
  for (const [raw, payee] of card) {
    it(`card: ${payee}`, () => expect(cleanPayee(raw, 'card')).toBe(payee));
  }
});

describe('tidyName', () => {
  it('strips company suffixes and title-cases shouting text, keeping acronyms', () => {
    expect(tidyName('CASA EXAMPLE PTE. L')).toBe('Casa Example');
    expect(tidyName('EXAMPLE WALLS PTE. LTD.')).toBe('Example Walls');
    expect(tidyName('THE MANAGEMENT CORPORATION STRA')).toBe('The Management Corporation Stra');
    expect(tidyName('Alex Tan DBS')).toBe('Alex Tan DBS');
    expect(tidyName('M&S SINGAPORE PTE LTD')).toBe('M&S');
    expect(tidyName('BGP LTD')).toBe('BGP');
    expect(tidyName('MR EXAMPLE')).toBe('Mr Example');
    expect(tidyName('EXAMPLE CAFE - TCM')).toBe('Example Cafe - TCM');
  });
});
