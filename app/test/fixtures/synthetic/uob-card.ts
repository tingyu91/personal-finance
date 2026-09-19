import { at, doc, line, page, right } from '../pdf';

/**
 * Invented UOB credit card statement dated 20 JAN 2026 (so December rows roll back to 2025).
 * Every figure here is made up. Two card accounts:
 * - PREFERRED VISA, principal ·1111 (ALEX TAN) with supplementary ·2222 (SAM LEE).
 *   Previous balance 610.00 paid by a CR; SAM LEE's section runs over a page break and holds
 *   an FX row and a refund CR: 3.35 + 92.10 + 15.35 + 243.80 − 92.10 + 71.65 = 334.15.
 * - KRISFLYER UOB CREDIT CARD, principal ·3333 alone: one 135.00 charge.
 */
const AMT = 546;
const amt = (s: string) => right(AMT, s);
const cr = (s: string) => right(AMT + 14, `${s} CR`);
const legal = [
  line(47, at(36, 'Please note that you are bound by a duty under the rules governing the operation of this account.')),
  line(19, at(36, 'United Overseas Bank Limited • 1 Example Place Singapore 000000 •'), at(435, 'www.uob.com.sg')),
];
const tableHead = (y: number) => [
  line(y, at(63, 'Post'), at(103.5, 'Trans'), at(148.8, 'Description of Transaction'), right(545.6, 'Transaction Amount')),
  line(y - 8, at(63, 'Date'), at(103.5, 'Date'), right(545.7, 'SGD')),
];
const row = (y: number, post: string, trans: string, desc: string, amount: ReturnType<typeof right>) =>
  line(y, at(61, post), at(103, trans), at(149, desc), amount);
const ref = (y: number, n: string) => line(y, at(149, `Ref No. : 7400000000000000000${n}`));

export const uobCard = doc(
  page(
    1,
    line(743, at(380, 'Statement Summary')),
    line(730, at(380, 'Statement Date'), at(503, '20 JAN 2026')),
    line(725, at(54, 'MR ALEX TAN')),
    line(714, at(54, '2 EXAMPLE ROAD #01-01')),
    line(704, at(54, 'SINGAPORE 000000')),
    line(672, at(380, 'Amount to Pay'), right(556, 'SGD 469.15')),
    line(647, at(47, 'Credit Card(s) Statement'), at(380, 'Due Date'), at(505, '09 FEB 2026')),
    line(622, at(61, 'Summary')),
    line(605, at(61, 'Card Name'), at(152, 'Card Number'), at(257, 'Name on Card'), at(411, 'Amount to'), at(503, 'Minimum')),
    line(583, at(61, 'PREFERRED VISA'), at(152, '4000-1234-1234-1111'), at(257, 'ALEX TAN'), right(455, '334.15'), right(545, '47.13')),
    line(562, at(61, 'KRISFLYER UOB'), at(152, '4000-1234-1234-3333'), at(257, 'ALEX TAN'), right(455, '135.00'), right(545, '47.13')),
    line(553, at(61, 'CREDIT CARD')),
    line(541, right(455, '469.15'), right(545, '94.26')),
    line(508, at(61, 'PREFERRED VISA')),
    line(487, at(61, '4000-1234-1234-1111 ALEX TAN')),
    ...tableHead(468),
    line(438, at(149, 'PREVIOUS BALANCE'), amt('610.00')),
    row(417, '22 DEC', '22 DEC', 'PAYMENT - DBS INTERNET/WIRELESS', cr('610.00')),
    ref(408, '1'),
    line(387, at(149, 'SUB TOTAL'), amt('0.00')),
    line(352, at(61, 'PREFERRED VISA')),
    line(331, at(61, '4000-1234-1234-2222 SAM LEE')),
    ...tableHead(312),
    line(282, at(149, 'PREVIOUS BALANCE'), amt('0.00')),
    row(261, '23 DEC', '21 DEC', 'BUS/MRT 123456789 SINGAPORE', amt('3.35')),
    ref(252, '2'),
    row(231, '02 JAN', '30 DEC', 'LALAMOVE Singapore', amt('92.10')),
    ref(222, '3'),
    ...legal,
  ),
  page(
    2,
    line(761, at(519, 'Page 2 of 3')),
    line(735, at(61, 'PREFERRED VISA')),
    line(714, at(61, '4000-1234-1234-2222 SAM LEE (continued)')),
    ...tableHead(695),
    row(665, '05 JAN', '04 JAN', 'APPLE.COM/BILL 1234567890', amt('15.35')),
    ref(656, '4'),
    line(646, at(149, 'USD 11.37')),
    row(625, '07 JAN', '05 JAN', 'IKEA SINGAPORE', amt('243.80')),
    ref(616, '5'),
    row(595, '08 JAN', '06 JAN', 'LALAMOVE Singapore', cr('92.10')),
    ref(586, '6'),
    row(565, '15 JAN', '14 JAN', 'SHOPEE SINGAPORE MP', amt('71.65')),
    ref(556, '7'),
    line(535, at(149, 'SUB TOTAL'), amt('334.15')),
    line(515, at(149, 'TOTAL BALANCE FOR PREFERRED VISA'), amt('334.15')),
    line(480, at(61, 'KRISFLYER UOB CREDIT CARD')),
    line(459, at(61, '4000-1234-1234-3333 ALEX TAN')),
    ...tableHead(440),
    line(410, at(149, 'PREVIOUS BALANCE'), amt('0.00')),
    row(389, '16 JAN', '14 JAN', 'SINGAPORE AIRLINES 6181234567890 SINGAPORE', amt('135.00')),
    ref(380, '8'),
    line(359, at(149, 'SUB TOTAL'), amt('135.00')),
    line(339, at(149, 'TOTAL BALANCE FOR KRISFLYER UOB CREDIT CARD'), amt('135.00')),
    line(303, at(50, '-------------------- End of Transaction Details --------------------')),
    ...legal,
  ),
  page(
    3,
    line(761, at(519, 'Page 3 of 3')),
    line(735, at(61, 'Rewards Summary')),
    line(721, at(47, '09 JAN 2026 LALAMOVE UNI$-16')),
    line(679, at(47, 'UNI$'), at(146, '-'), right(260, '1,000.00'), right(310, '47.13')),
    ...legal,
  ),
);
