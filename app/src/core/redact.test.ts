import { describe, it, expect } from 'vitest';
import { findIdentifiers, lastFour, redact } from './redact';

describe('redact', () => {
  it('masks NRIC/FIN, card and account numbers, keeps amounts and short refs', () => {
    expect(redact('PTXP S1234567D IRAS')).toBe('PTXP [NRIC] IRAS');
    expect(redact('TAXS G7654321X')).toBe('TAXS [NRIC]');
    expect(redact('CCC - 4111111111111111 : I-BANK')).toBe('CCC - ·1111 : I-BANK');
    expect(redact('Account No. 123-456789-0')).toBe('Account No. ·7890');
    expect(redact('1234 5678 9012 3456')).toBe('·3456');
    expect(redact('PAYNOW TRANSFER 1234567')).toBe('PAYNOW TRANSFER 1234567');
    expect(redact('PURCH 3.90, CSHBACK 100.00')).toBe('PURCH 3.90, CSHBACK 100.00');
    expect(redact('BUS/MRT 123456789 SINGAPORE')).toBe('BUS/MRT ·6789 SINGAPORE');
    expect(redact('20/08/2026 INS 02 2026')).toBe('20/08/2026 INS 02 2026');
    expect(redact('UOB 1234 1234567')).toBe('UOB 1234 1234567');
    expect(redact('1234 5678')).toBe('1234 5678');
  });
  it('masks bare seven-digit-and-letter references', () => {
    expect(redact('IRAS 7654321N')).toBe('IRAS ·4321N');
  });
  it('leaves dates alone', () => {
    expect(redact('due 2026-09-19')).toBe('due 2026-09-19');
    expect(redact('due 19-09-2026')).toBe('due 19-09-2026');
    expect(findIdentifiers('2026-09-19T00:00:00.000Z')).toEqual([]);
  });
  it('leaves already-redacted text alone', () => {
    expect(redact(redact('CCC - 4111111111111111'))).toBe('CCC - ·1111');
  });
});

describe('lastFour', () => {
  it('takes the last four digits of the longest number', () => {
    expect(lastFour('Account No. 123-456789-0')).toBe('7890');
    expect(lastFour('4111-1111-1111-1234 ALEX TAN')).toBe('1234');
    expect(lastFour('One Account 987-654-321-7')).toBe('3217');
    expect(lastFour('no digits')).toBeNull();
  });
});

describe('findIdentifiers', () => {
  it('finds what redaction would remove', () => {
    expect(findIdentifiers('ok 1,234.56 ·1111 1234567')).toEqual([]);
    expect(findIdentifiers('x T7654321Z y 12345678')).toEqual(['T7654321Z', '12345678']);
    expect(findIdentifiers('4111-1111-1111-1111')).toEqual(['4111-1111-1111-1111']);
  });
});
