import { at, doc, line, page, right } from '../pdf';

/**
 * Invented DBS/POSB consolidated statement, August 2026, joint account "ALEX TAN/ SAM LEE",
 * account ending 9871. Laid out like the real one: two pages of SGD rows with a page carry,
 * a balance checkpoint line, and an empty USD section. Every figure here is made up.
 *
 * SGD: opening 1,000.00; withdrawals 213.45 + 17.00 + 1,318.27 = 1,548.72;
 * deposits 612.00 + 1,650.00 = 2,262.00; closing 1,713.28.
 */
const W = 395; // withdrawal amounts end here
const D = 474; // deposit amounts end here
const B = 548; // balance amounts end here

const header = (y: number) =>
  line(y, at(45.4, 'Date'), at(113.1, 'Description'), right(397.4, 'Withdrawal (-)'), right(476.5, 'Deposit (+)'), right(549.9, 'Balance'));
const footer = (n: number) => [
  line(28, at(16, 'DBS Co. Reg. No. 000000000X GST Reg No: MR-0000000-0')),
  line(21, at(41, 'Transaction Details as of 31 Aug 2026'), at(511, `Page ${n} of 4`)),
  line(5, at(248, 'PDS_MMCON_LOC_ONSH_0000000000000000_00000')),
];

export const dbsConsolidated = doc(
  page(
    1,
    line(717, at(72, 'S/N: EN0000000000')),
    line(711, at(401, 'Consolidated Statement')),
    line(685, at(72, 'ALEX TAN/')),
    line(675, at(72, 'SAM LEE')),
    line(664, at(72, 'BLK 1 EXAMPLE ROAD')),
    line(654, at(72, '#01-01 EXAMPLE TOWER')),
    line(644, at(72, 'SINGAPORE 000000')),
    line(508, at(34, 'Account Summary'), at(231, 'as at 31 Aug 2026')),
    line(448, at(45, 'Current and Savings Account'), at(421, 'Total: SGD Equivalent 1,714.54')),
    line(333, at(45, 'My Account'), at(271, '111-222987-1'), at(398, 'SGD'), right(476, '1,713.28'), right(550, '1,713.28')),
    ...footer(1),
  ),
  page(
    2,
    line(692, at(34, 'Transaction Details'), at(253, 'as at 31 Aug 2026')),
    line(654, at(55, 'Deposits')),
    line(626, at(45, 'My Account'), at(441, 'Account No. 111-222987-1')),
    header(604),
    line(574, at(53, 'CURRENCY: SINGAPORE DOLLAR')),
    line(549, at(113.1, 'Balance Brought Forward'), right(B, 'SGD 1,000.00')),
    line(531, at(45.4, '01/08/2026'), at(113.1, 'Purchase with Cash Withdrawal'), right(W, '213.45'), right(B, '786.55')),
    line(521, at(113.1, '4000123412340001,7-ELEVEN-EXAMPLE #01-01')),
    line(510, at(113.1, 'PURCH 13.45, CSHBACK 200.00')),
    line(493, at(45.4, '07/08/2026'), at(113.1, 'Advice FAST Payment / Receipt'), right(W, '17.00'), right(B, '769.55')),
    line(483, at(113.1, 'PAYNOW TRANSFER 1234567')),
    line(473, at(113.1, 'TO: JOHN DOE')),
    line(462, at(113.1, 'PAYNOW TRANSFER')),
    line(452, at(113.1, 'OTHER')),
    line(435, at(45.4, '19/08/2026'), at(113.1, 'Advice FAST Payment / Receipt'), right(D, '612.00'), right(B, '1,381.55')),
    line(425, at(113.1, 'SAM LEE HOUSEHOLD AUG')),
    line(414, at(113.1, 'ABCD0101OCBCSGSGBRT7000001')),
    line(404, at(113.1, 'OTHER')),
    line(62, at(113.1, 'Balance Carried Forward'), right(B, 'SGD 1,381.55')),
    ...footer(2),
  ),
  page(
    3,
    line(702, at(45, 'My Account'), at(441, 'Account No. 111-222987-1')),
    header(681),
    line(670, at(34, 'w')),
    line(653, at(113.1, 'Balance Brought Forward'), right(B, 'SGD 1,381.55')),
    line(635, at(45.4, '20/08/2026'), at(113.1, 'Advice Bill Payment'), right(W, '1,318.27'), right(B, '63.28')),
    line(625, at(113.1, 'CCC - 4000123412345566 : I-BANK')),
    line(615, at(113.1, 'REF: 1234567890120001')),
    line(598, at(45.4, '28/08/2026'), at(113.1, 'Advice FAST Payment / Receipt'), right(D, '1,650.00'), right(B, '1,713.28')),
    line(588, at(113.1, 'OTHER')),
    line(578, at(113.1, 'ABCD0102OCBCSGSGBRT5000002')),
    line(568, at(113.1, 'OTHER')),
    line(551, at(45.4, '31/08/2026'), right(B, '1,713.28')),
    line(530, at(113.1, 'Total Balance Carried Forward in SGD:'), right(W, '1,548.72'), right(D, '2,262.00'), right(B, '1,713.28')),
    header(496),
    line(465, at(44, 'CURRENCY: UNITED STATES DOLLAR')),
    line(440, at(113.1, 'Balance Brought Forward'), right(B, 'USD 1.00')),
    line(416, at(113.1, 'Total Balance Carried Forward in USD:'), right(W, '0.00'), right(D, '0.00'), right(B, '1.00')),
    line(405, at(113.1, 'Indicative in SGD @ 1.2600000'), right(B, '1.26')),
    ...footer(3),
  ),
  page(4, line(695, at(51, 'Messages For You')), line(656, at(62, 'Please examine this statement. Contact 1800 000 0000.')), ...footer(4)),
);
