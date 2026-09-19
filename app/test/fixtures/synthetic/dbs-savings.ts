import { at, doc, line, page, right } from '../pdf';

/**
 * Invented DBS savings statement, February 2026, owner "ALEX TAN", account ending 9876.
 * Balances print only on the last row of each day, as in the real layout. Every figure here
 * is made up.
 *
 * Opening 2,000.00; withdrawals 6.40 + 2.30 + 23.10 + 68.42 + 1,742.18 = 1,842.40;
 * deposits 187.25 + 725.00 + 0.12 = 912.37; closing 1,069.97.
 */
const W = 362;
const D = 442;
const B = 521;

const top = (n: number) => [
  line(766, at(34, 'DBS Bank Ltd')),
  line(760, at(34, '12 Example Boulevard, Singapore 000000')),
  line(702, at(423, `Page ${n} of 3`)),
];
const header = (y: number) =>
  line(y, at(36.9, 'DATE'), at(96.6, 'DETAILS OF TRANSACTIONS'), right(362.3, 'WITHDRAWAL($)'), right(441.9, 'DEPOSIT($)'), right(521.4, 'BALANCE($)'));
const account = (y: number) => line(y, at(37, 'Details of Your DBS Savings Account'), at(404, 'Account No.: 120-4-509876'));
const footer = line(12, at(207, 'PDS_DQ94MTHENDE_E_LOC_FD_000000000000_00000'));

export const dbsSavings = doc(
  page(
    1,
    ...top(1),
    line(683, at(256, '000000000000-0001')),
    line(657, at(72, 'ALEX TAN')),
    line(646, at(72, 'BLK 2 EXAMPLE STREET 1')),
    line(626, at(72, 'SINGAPORE 000000')),
    line(566, at(444, 'As at 28 Feb 2026')),
    account(544),
    header(524),
    line(493, at(97, 'Balance Brought Forward'), right(B, '2,000.00')),
    line(477, at(37, '01 Feb'), at(97, 'Funds Transfer'), right(W, '6.40')),
    line(469, at(102, 'TOP-UP TO PAYLAH! :')),
    line(461, at(102, 'ALEX TAN')),
    line(453, at(102, 'PLPE0000000000000001')),
    line(437, at(37, '01 Feb'), at(97, 'Funds Transfer'), right(W, '2.30'), right(B, '1,991.30')),
    line(429, at(102, 'TOP-UP TO PAYLAH! :')),
    line(421, at(102, 'ALEX TAN')),
    line(413, at(102, 'PLPE0000000000000002')),
    line(397, at(37, '05 Feb'), at(97, 'FAST Payment / Receipt'), right(W, '23.10'), right(B, '1,968.20')),
    line(389, at(102, 'PayNow Transfer 1234567')),
    line(381, at(102, 'To: CHEONG')),
    line(373, at(102, 'PayNow transfer')),
    line(365, at(102, 'Other')),
    line(62, at(97, 'Balance Carried Forward'), right(B, '1,968.20')),
    footer,
  ),
  page(
    2,
    ...top(2),
    account(680),
    header(660),
    line(630, at(97, 'Balance Brought Forward'), right(B, '1,968.20')),
    line(614, at(37, '15 Feb'), at(97, 'FAST Payment / Receipt'), right(D, '187.25')),
    line(606, at(102, 'Incoming PayNow Ref 0000001')),
    line(598, at(102, 'From: JOHN DOE')),
    line(590, at(102, 'Other')),
    line(574, at(37, '15 Feb'), at(97, 'Payments / Collections via GIRO'), right(W, '68.42'), right(B, '2,087.03')),
    line(566, at(102, 'INSURER-OPERATIONS')),
    line(558, at(102, 'INS 02 2026')),
    line(550, at(102, '000000123456')),
    line(534, at(37, '23 Feb'), at(97, 'Bill Payment'), right(W, '1,742.18'), right(B, '344.85')),
    line(526, at(102, 'CCC - 4000123412345566 : I-BANK')),
    line(518, at(102, 'REF: 1234567890120002')),
    line(502, at(37, '25 Feb'), at(97, 'Quick Cheque Deposit'), right(D, '725.00'), right(B, '1,069.85')),
    line(486, at(37, '28 Feb'), at(97, 'Interest Earned'), right(D, '0.12'), right(B, '1,069.97')),
    line(470, at(97, 'Total'), right(W, '1,842.40'), right(D, '912.37')),
    line(454, at(97, 'Balance Carried Forward'), right(B, '1,069.97')),
    line(427, at(37, 'Message For You')),
    line(400, at(73, 'For all enquiries, please call us at 1800 000 0000')),
    footer,
  ),
  page(3, ...top(3), line(672, at(34, 'DEPOSIT INSURANCE SCHEME')), footer),
);
