/** Accounts are always shown as bank + product + last four ("UOB One ·1234"), never in full. */
export interface LabelParts {
  bank: string;
  product: string;
  last4: string;
  currency?: string;
  label?: string | null;
}

export function accountLabel(a: LabelParts): string {
  const name = a.label ? a.label : a.product.toUpperCase().startsWith(a.bank.toUpperCase()) ? a.product : `${a.bank} ${a.product}`;
  const four = a.last4 ? ` ·${a.last4}` : '';
  const ccy = a.currency && a.currency !== 'SGD' ? ` (${a.currency})` : '';
  return `${name}${four}${ccy}`;
}
