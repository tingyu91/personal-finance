import { at, doc, line, page, right } from '../pdf';

/**
 * Invented UOB One Account statement, July 2026, owner "ALEX TAN", account ending 5555.
 * Every row prints its balance. Page 1 carries the overview and the bonus-interest block.
 * Every figure here is made up.
 *
 * Opening 38,500.25; withdrawals 15,000.00 + 689.40 + 250.00 + 750.00 = 16,689.40;
 * deposits 8,400.00 + 1.37 = 8,401.37; closing 30,212.22.
 */
const W = 387;
const D = 466;
const B = 546;

const legal = [
  line(49, at(37, 'Please note that you are bound by a duty under the rules governing the operation of this account.')),
  line(22, at(37, 'United Overseas Bank Limited • 1 Example Place Singapore 000000 • Co. Reg. No. 000000000X •'), at(433, 'www.uob.com.sg')),
];
const detailsHeader = (y: number) => [
  line(y, at(52, 'Date'), at(120.5, 'Description'), right(386.9, 'Withdrawals'), right(466.3, 'Deposits'), right(545.6, 'Balance')),
  line(y - 7, right(386.9, 'SGD'), right(466.3, 'SGD'), right(545.7, 'SGD')),
];

export const uobOne = doc(
  page(
    1,
    line(713, at(76, 'ALEX TAN')),
    line(704, at(76, '2 EXAMPLE ROAD')),
    line(686, at(76, 'SINGAPORE 000000')),
    line(591, at(514, 'Page 1 of 3')),
    line(576, at(47, 'Statement of Account')),
    line(564, at(47, 'Period: 01 Jul 2026 to 31 Jul 2026')),
    line(546, at(61, 'Account Overview as at 31 Jul 2026')),
    line(434, at(197, 'Currency'), at(260, 'Credit Line'), at(322, 'Interest Earned^'), at(400, 'Interest Charged^'), right(545.6, 'Balance')),
    line(407, at(53, 'One Account'), at(197, 'SGD'), right(310, '0.00'), right(395, '21.46'), right(478, '-'), right(545, '30,212.22')),
    line(398, at(53, '987-654-555-5')),
    line(356, at(301, 'Grand Total (SGD Equivalent )'), right(545, '30,212.22')),
    line(343, at(57, 'Interest Earned/Charged for 2026')),
    line(259, at(61, 'ONE Account Interest Overview^')),
    line(222, at(61, 'Credit Card Eligible Spend'), right(545, '164.20')),
    line(203, at(61, 'Debit Card Eligible Spend'), right(545, '0.00')),
    line(184, at(61, 'Total Card(s) Eligible Spend'), right(545, '164.20')),
    line(164, at(61, 'Bonus Interest earned'), right(545, '-')),
    line(155, at(61, '^for June 2026')),
    ...legal,
  ),
  page(
    2,
    line(744, at(518, 'Page 2 of 3')),
    line(687, at(52, 'Account Transaction Details')),
    line(668, at(52, 'One Account'), at(112, '987-654-555-5')),
    ...detailsHeader(645),
    line(622, at(52, '01 Jul'), at(120.5, 'BALANCE B/F'), right(B, '38,500.25')),
    line(604, at(52, '03 Jul'), at(120.5, 'Bill Payment'), right(W, '15,000.00'), right(B, '23,500.25')),
    line(594, at(120.5, 'mBK-Citi CC')),
    line(585, at(120.5, '4000123412347788')),
    line(567, at(52, '06 Jul'), at(120.5, 'Inward DR - GIRO'), right(W, '689.40'), right(B, '22,810.85')),
    line(557, at(120.5, 'PTXP S1234567D')),
    line(548, at(120.5, 'IRAS')),
    line(539, at(120.5, '7654321N')),
    line(521, at(52, '14 Jul'), at(120.5, 'PAYNOW-FAST'), right(W, '250.00'), right(B, '22,560.85')),
    line(511, at(120.5, 'PIB0000000000000011')),
    line(502, at(120.5, 'EXAMPLE WALLET PTE')),
    line(493, at(120.5, 'OTHR P00000000QR')),
    line(475, at(52, '16 Jul'), at(120.5, 'Inward CR - GIRO'), right(D, '8,400.00'), right(B, '30,960.85')),
    line(466, at(120.5, 'SALA Salary Payment')),
    line(456, at(120.5, 'EXAMPLE EMPLOYER PTE')),
    line(447, at(120.5, '0000001111A11AAA')),
    ...legal,
  ),
  page(
    3,
    line(744, at(518, 'Page 3 of 3')),
    line(722, at(52, 'Account Transaction Details')),
    line(703, at(52, 'One Account'), at(112, '987-654-555-5 (continued)')),
    ...detailsHeader(682),
    line(657, at(52, '20 Jul'), at(120.5, 'Funds Trf - FAST'), right(W, '750.00'), right(B, '30,210.85')),
    line(647, at(120.5, 'PIB0000000000000022')),
    line(638, at(120.5, 'AT & SL Joint')),
    line(629, at(120.5, 'OTHR Transfer')),
    line(611, at(52, '31 Jul'), at(120.5, 'Interest Credit'), right(D, '1.37'), right(B, '30,212.22')),
    line(593, at(120.5, 'Total'), right(W, '16,689.40'), right(D, '8,401.37'), right(545, '30,212.22')),
    line(575, at(47, '-------------'), at(259, 'End of Transaction Details'), at(366, '-------------')),
    ...legal,
  ),
);
