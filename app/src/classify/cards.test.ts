import { describe, it, expect } from 'vitest';
import { cardTarget, isCardRepaymentInflow } from './cards';

describe('card targets', () => {
  it('reads the card a bill payment names', () => {
    expect(cardTarget('Advice Bill Payment · CCC - ·1111 : I-BANK · REF: ·3456')).toEqual({ issuer: null, last4: '1111' });
    expect(cardTarget('Advice Bill Payment · AMEX-·7101 : I-BANK · REF: ·3456')).toEqual({ issuer: 'Amex', last4: '7101' });
    expect(cardTarget('Bill Payment · mBK-AMEX · ·7101')).toEqual({ issuer: 'Amex', last4: '7101' });
    expect(cardTarget('Bill Payment · mBK-Citi CC · ·7102')).toEqual({ issuer: 'Citi', last4: '7102' });
    expect(cardTarget('Bill Payment · mBK-UOB Cards · ·7103')).toEqual({ issuer: 'UOB', last4: '7103' });
    expect(cardTarget('Bill Payment · CCC - ·1111 : I-BANK · REF: ·3456 · VALUE DATE : 22/03/2026')).toEqual({ issuer: null, last4: '1111' });
  });

  it('ignores rows that are not card bill payments', () => {
    expect(cardTarget('PAYNOW-FAST · PIB·7104 · EXAMPLE PAINT PTE. LTD')).toBeNull();
    expect(cardTarget('Advice Bill Payment · SP SERVICES · REF: ·3456')).toBeNull();
  });

  it('recognises repayments arriving on a card', () => {
    expect(isCardRepaymentInflow('DBS Visa Direct')).toBe(true);
    expect(isCardRepaymentInflow('PAYMT THRU E-BANK/HOMEB/CYBERB (EP06)')).toBe(true);
    expect(isCardRepaymentInflow('DBS BANK Singapore')).toBe(true);
    expect(isCardRepaymentInflow('PAYMENT - DBS INTERNET/WIRELESS')).toBe(true);
    expect(isCardRepaymentInflow('GIRO PAYMENT')).toBe(true);
    expect(isCardRepaymentInflow('CR ANNUAL RENEWAL FEE - INCL OF GST')).toBe(false);
    expect(isCardRepaymentInflow('LALAMOVE Singapore')).toBe(false);
  });
});
