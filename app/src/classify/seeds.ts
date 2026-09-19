import type { Kind } from './categories';

/**
 * Seeded rules for common Singapore merchants and billers (PRD §7.3 step 6). Ordered: the
 * first match wins, and your own rules always run before these. Nothing personal belongs
 * here; names of people and your vendors live in data/rules and the database.
 *
 * Each rule tests "payee | raw". Spend rules apply to outflows, and to credits on a card (a
 * merchant refund reduces spending in its category). They never turn a bank-account inflow
 * into spending.
 */
export interface SeedRule {
  id: string;
  test: RegExp;
  sign?: 'in' | 'out';
  kind: Kind;
  category?: string;
  bucket?: string;
  payee?: string;
}

const FOOD = [
  'NTUC', 'FAIRPRICE', '\\bFP[- ]', 'COLD STORAGE', 'CS FRESH', 'SHENG SIONG', '\\bGIANT\\b', 'DON ?DON ?DONKI', 'DONKI', 'MUSTAFA',
  'SUPERMARKET', 'REDMART', 'HAO MART', 'MCDONALD', 'BURGER', 'SUBWAY', '\\bKFC\\b', 'KOPITIAM', 'KOUFU', 'FOOD ?REPUBLIC',
  'FOOD ?JUNCTION', '^FJ ', 'HAWKER', 'BREADTALK', 'TOAST BOX', 'YA KUN', 'STARBUCKS', 'LUCKIN', 'CHAGEE', 'KOI TH',
  'PARIS BAGUETTE', '7-ELEVEN', '\\bCHEERS\\b', 'BENGAWAN', 'SUSHI', 'SOUP SPOON', 'BAKERY', '\\bCAFE\\b', 'COFFEE', 'RESTAURANT',
  'BISTRO', 'NOODLE', 'PIZZA', 'PLAYMADE', 'MOLLY TEA', '\\bBAO\\b', 'TONKOTSU', 'RAMEN', 'GOCHI', 'GOKOKU', 'BAPSANG', 'RASAPURA',
  'SATAY', 'GRABFOOD', 'FOODPANDA', 'DELIVEROO', 'NETS QR', 'QASHIER', 'F&N FOODS', 'BASKIN', 'DOUGH', 'POLAR PUFFS', 'FOUR LEAVES',
  'MEN DON TEI', 'SALAD', 'STEAK', 'OLD TEA HUT', 'MR BEAN', 'FUN TOAST', 'VEG RICE', 'FOOD', 'DINING', 'EATERY', 'KITCHEN',
];
const HEALTH = [
  'GUARDIAN', 'WATSONS', 'UNITY PHARM', 'DENTAL', 'CLINIC', 'DERMATOLOG', 'MEDICAL', 'HOSPITAL', 'PHARMACY', 'POLYCLINIC',
  'RAFFLESMED', 'PARKWAY', 'MANULIFE', 'PRUDENTIAL', '\\bAIA\\b', 'GREAT EASTERN', 'INCOME INSURANCE', 'INSURANCE', 'BEAUTY',
  'SALON', '\\bHAIR', '\\bSPA\\b', 'MASSAGE', 'CLASSPASS', '\\bGYM\\b', 'FITNESS', 'ACTIVESG', 'TOOTH', 'HOCKHUA', 'TONIC', 'OPTICAL',
];
const SHOPPING = [
  'SHOPEE', 'LAZADA', 'AMAZON', 'APPLE\\.COM', 'GOOGLE', 'SPOTIFY', 'NETFLIX', 'DISNEY', 'YOUTUBE', 'MUJI', 'DAISO', 'UNIQLO',
  'POPULAR BOOK', 'M & S', 'MARKS & SPENCER', '\\bGIGA\\b', 'SINGTEL', 'STARHUB', '\\bM1\\b', 'CIRCLES', 'SIMBA', 'TAOBAO',
  'CAROUSELL', 'PAYPAL', 'D ?J\\*', 'DECATHLON', '\\bH&M\\b', '\\bZARA\\b', 'COTTON ON', 'CHARLES & KEITH', 'SINGPOST', 'MINISO',
  'SEPHORA', 'CHALLENGER', 'OSIM',
];
const TRAVEL = [
  'AGODA', 'BOOKING\\.COM', 'KLOOK', 'SINGAPORE AIRLINES', 'SINGAPOREAIR', 'SCOOT', 'JETSTAR', 'AIRASIA', 'AIRBNB', 'EXPEDIA',
  'TRIP\\.COM', '\\bHOTEL', 'SHAW THEATRES', 'GV ONLINE', 'GOLDEN VILLAGE', 'CATHAY CINE', 'SISTIC', 'TICKETMASTER', 'BADMINTON',
  '42RACE', 'MARATHON', 'SENTOSA', 'MANDAI', 'UNIVERSAL STUDIOS', '\\bFLIGHTS?\\b',
  // Singapore Airlines tickets print as "SINGAPORE" followed by the ticket number.
  '^SINGAPORE ?·\\d{4}',
];
const TRANSPORT = [
  'BUS/MRT', '\\bTADA\\b', 'GOJEK', 'COMFORT', 'CDG ZIG', '\\bGRAB\\b(?!.*FOOD)', 'TRANSITLINK', 'EZ-?LINK', 'SIMPLYGO', '\\bSMRT\\b',
  'LALAMOVE', 'PARKING', 'CARPARK', '\\bURA\\b', '\\bESSO\\b', 'CALTEX', '\\bSPC\\b', 'BLUESG', 'GETGO',
];
const FAMILY = ['DONATION', 'CHARITY', 'GIVE\\.ASIA', 'GIVING\\.SG', 'RED CROSS', '\\bSPCA\\b', 'TEMPLE', 'CHURCH', 'ANG ?BAO', 'HONGBAO'];

const any = (words: string[]) => new RegExp(words.join('|'), 'i');

export const SEED_RULES: SeedRule[] = [
  // Income
  { id: 'salary', test: /\bSALA\b|\bSALARY\b/i, sign: 'in', kind: 'income', category: 'Salary' },
  { id: 'interest', test: /^Interest \||Interest (Earned|Credit)\b/i, sign: 'in', kind: 'income', category: 'Interest' },
  // Tax and home running costs
  { id: 'income-tax', test: /\bTAXS\b|IRAS.*Income Tax/i, sign: 'out', kind: 'tax', payee: 'IRAS income tax' },
  { id: 'property-tax', test: /\bPTXP\b/, sign: 'out', kind: 'spend', category: 'Home running', payee: 'IRAS property tax' },
  { id: 'mortgage', test: /\bMortgage Loan\b/i, sign: 'out', kind: 'spend', category: 'Home running', payee: 'Mortgage' },
  { id: 'mcst', test: /MANAGEMENT CORPORATION|\bMCST\b/i, sign: 'out', kind: 'spend', category: 'Home running' },
  { id: 'utilities', test: /SP DIGITAL|SP SERVICES|SP GROUP|SERAYA|GENECO|TUAS POWER|SENOKO|PACIFICLIGHT|KEPPEL ELEC|CITY GAS|TOWN COUNCIL/i, sign: 'out', kind: 'spend', category: 'Home running' },
  { id: 'home-internet', test: /VIEWQWEST|MYREPUBLIC|WHIZCOMMS|BROADBAND/i, sign: 'out', kind: 'spend', category: 'Home running' },
  { id: 'hdb', test: /HOUSING & DEVELOPMENT/i, sign: 'out', kind: 'spend', category: 'Home running' },
  // Home project
  { id: 'valuation', test: /\bVAL FEE\b|VALUATION/i, sign: 'out', kind: 'spend', category: 'Home project', bucket: 'purchase', payee: 'Valuation fee' },
  { id: 'cashiers-order', test: /DR CO CHARGES/, sign: 'out', kind: 'spend', category: 'Home project', bucket: 'purchase' },
  { id: 'furnishing', test: /\bIKEA\b(?!.*(BISTRO|RESTAURANT|CAFE|FOOD))|\bCOURTS\b|HARVEY NORMAN|GAIN CITY|BEST DENKI|HOMEPRO|CASTLERY|HIP ?VAN/i, kind: 'spend', category: 'Home project', bucket: 'furnishing' },
  { id: 'renovation', test: /LIGHT(ING)? CONCEPTS|LIGHTING|RENOVATION|INTERIOR|CARPENTRY|\bPAINT\b|PLUMB|ELECTRICAL|\bTILES?\b|WALLPAPER|CURTAIN/i, kind: 'spend', category: 'Home project', bucket: 'renovation' },
  // Fees (after the rules above, so "VAL FEE" and "DR CO CHARGES" stay with the home)
  { id: 'fees', test: /\bFEES?\b|\bCHARGES?\b|LATE CHARGE|FINANCE CHARGE|\bComm &|DEDUCTED UNI\$/i, kind: 'fee' },
  // Everyday categories
  { id: 'transport', test: any(TRANSPORT), kind: 'spend', category: 'Transport' },
  { id: 'food', test: any(FOOD), kind: 'spend', category: 'Food & groceries' },
  { id: 'health', test: any(HEALTH), kind: 'spend', category: 'Health & personal care' },
  { id: 'shopping', test: any(SHOPPING), kind: 'spend', category: 'Shopping & subscriptions' },
  { id: 'travel', test: any(TRAVEL), kind: 'spend', category: 'Travel & leisure' },
  { id: 'family', test: any(FAMILY), kind: 'spend', category: 'Family & giving' },
];

/** Canonical payee names for merchants whose statement text carries a reference. */
export const PAYEE_NAMES: [RegExp, string][] = [
  [/^BUS\/MRT/i, 'Bus/MRT'],
  [/^SINGAPORE ?·\d{4}/i, 'Singapore Airlines'],
  [/^APPLE\.COM/i, 'Apple'],
  [/^Spotify/i, 'Spotify'],
  [/^McDonalds|^MCDONALD/i, 'McDonald’s'],
  [/^GIGA\b/i, 'GIGA'],
  [/^WWW\.TADA/i, 'TADA'],
];
