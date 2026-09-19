import { describe, it, expect } from 'vitest';
import { formatSGD, parseAmount } from './money';

describe('parseAmount', () => {
  it('reads statement amounts into integer cents', () => {
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('0.10')).toBe(10);
    expect(parseAmount('1,234,567.89')).toBe(123456789);
    expect(parseAmount(' 432.10 ')).toBe(43210);
  });
  it('rejects anything that is not a two-decimal amount', () => {
    expect(parseAmount('12')).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount('SGD 2,345.67')).toBeNull();
    expect(parseAmount('1,2.33')).toBeNull();
  });
  it('never goes through floating point', () => {
    expect(parseAmount('0.29')).toBe(29);
    expect(parseAmount('123,456.78')).toBe(12345678);
  });
});

describe('formatSGD', () => {
  it('formats cents with a true minus', () => {
    expect(formatSGD(123456)).toBe('S$1,234.56');
    expect(formatSGD(-5)).toBe('−S$0.05');
    expect(formatSGD(0)).toBe('S$0.00');
    expect(formatSGD(123456789)).toBe('S$1,234,567.89');
  });
});
