import { describe, it, expect } from 'vitest';
import { hasTransferMarker, matchesAlias, matchesAnyPattern, sharesWord, significantWords } from './text';

describe('text helpers', () => {
  it('keeps only the words that identify a counterparty', () => {
    expect(significantWords('PayNow Transfer 1234 · To: CAROUSELL TRANSACTION · Other')).toEqual(['carousell', 'transaction']);
    expect(significantWords('FAST Payment / Receipt · CAROUSELLPAYMEEXAMPLE · ·0000DBSSSGSGBRT0000001 · Refund')).toEqual(['carousellpaymeexample']);
    expect(significantWords('Funds Transfer · TOP-UP TO PAYLAH! : · ALEX TAN')).toEqual(['alex']);
    expect(significantWords('Mortgage Loan · ·1234')).toEqual(['mortgage', 'loan']);
  });

  it('says when two texts name the same counterparty', () => {
    expect(sharesWord('PayNow Transfer 1234567 · To: CAROUSELL TRANSACTION · Other', 'CAROUSELLPAYMEEXAMPLE · ·0000DBSSSGSGBRT0000001 · Refund')).toBe(true);
    expect(sharesWord('Mortgage Loan · ·1234', 'Mortgage Loan · ·1234')).toBe(true);
    expect(sharesWord('Funds Transfer · TOP-UP TO PAYLAH! : · Alex', 'Funds Transfer · MAXED OUT FROM PAYLAH! : · Northpoint · TF·1234')).toBe(false);
    expect(sharesWord('LALAMOVE Singapore', 'LALAMOVE Singapore')).toBe(true);
    expect(sharesWord('DBS Visa Direct', 'IKEA SINGAPORE')).toBe(false);
  });

  it('matches aliases on word boundaries, ignoring case', () => {
    expect(matchesAlias('Alex Tan DBS', ['ALEX TAN'])).toBe(true);
    expect(matchesAlias('ALEX TAN', ['alex tan'])).toBe(true);
    expect(matchesAlias('SAMSUNG STORE', ['SAM'])).toBe(false);
    expect(matchesAlias('SAM GRAB', ['SAM'])).toBe(true);
    expect(matchesAlias('AT & SL Joint', ['AT & SL Joint'])).toBe(true);
    expect(matchesAlias('anything', [])).toBe(false);
  });

  it('matches configured reference patterns as plain text', () => {
    expect(matchesAnyPattern('HOME FUND · ·0101OCBCSGSGBRT7000001 · OTHER', ['OCBCSGSGBRT'])).toBe(true);
    expect(matchesAnyPattern('HOME FUND', ['OCBCSGSGBRT'])).toBe(false);
  });

  it('recognises bank-transfer markers', () => {
    expect(hasTransferMarker('FAST Payment / Receipt · UOB:·1234:I-BANK · Transfer')).toBe(true);
    expect(hasTransferMarker('Funds Transfer · FT0000MB·1234 · ·1234:IB')).toBe(true);
    expect(hasTransferMarker('Funds Trf - FAST · PIB·7106 · AT & SL Joint · OTHR Transfer')).toBe(true);
    expect(hasTransferMarker('FAST Payment / Receipt · mortgage · ·0000UOVBSGSGBRT0000001 · Other')).toBe(true);
    expect(hasTransferMarker('FAST Payment / Receipt · PayNow Transfer 1234567 · To: JOHN DOE · Other')).toBe(false);
  });
});
