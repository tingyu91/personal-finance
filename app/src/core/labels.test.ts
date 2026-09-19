import { describe, it, expect } from 'vitest';
import { accountLabel } from './labels';

describe('accountLabel', () => {
  it('writes bank, product and last four', () => {
    expect(accountLabel({ bank: 'DBS', product: 'My Account', last4: '9014' })).toBe('DBS My Account ·9014');
  });
  it('does not repeat the bank when the product already names it', () => {
    expect(accountLabel({ bank: 'UOB', product: 'UOB One Card', last4: '9015' })).toBe('UOB One Card ·9015');
    expect(accountLabel({ bank: 'UOB', product: 'KrisFlyer UOB Credit Card', last4: '9016' })).toBe('UOB KrisFlyer UOB Credit Card ·9016');
  });
  it('shows a non-SGD currency and omits an empty last four', () => {
    expect(accountLabel({ bank: 'DBS', product: 'My Account', last4: '9014', currency: 'USD' })).toBe('DBS My Account ·9014 (USD)');
    expect(accountLabel({ bank: 'DBS', product: 'PayLah', last4: '' })).toBe('DBS PayLah');
  });
  it('prefers a label the user set', () => {
    expect(accountLabel({ bank: 'DBS', product: 'My Account', last4: '9014', label: 'Joint' })).toBe('Joint ·9014');
  });
});
