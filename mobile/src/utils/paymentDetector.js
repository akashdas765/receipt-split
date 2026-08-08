// Detects bank "payment" transactions that are NOT real expenses: credit
// card payments, account transfers, loan payments, etc. — these should be
// excluded from expense totals. Ported from
// akashdas765/personal-expense-manager (utils/paymentDetector.js).

const PAYMENT_PATTERNS = [
  // Credit card payments
  /payment\s+thank\s+you/i,
  /thank\s+you\s+payment/i,
  /autopay/i,
  /auto\s+pay/i,
  /online\s+payment/i,
  /mobile\s+payment/i,
  /ach\s+payment/i,
  /credit\s+card\s+pay/i,
  /card\s+payment/i,
  /e-payment/i,

  // Transfers
  /account\s+transfer/i,
  /funds\s+transfer/i,
  /bank\s+transfer/i,
  /wire\s+transfer/i,
  /transfer\s+to\b/i,
  /transfer\s+from\b/i,
  /internet\s+transfer/i,
  /online\s+transfer/i,
  /zelle\s+transfer/i,
  /venmo\s+transfer/i,

  // Loan / mortgage payments
  /loan\s+payment/i,
  /mortgage\s+payment/i,
  /student\s+loan/i,
  /auto\s+loan/i,

  // Generic patterns
  /^payment$/i,
  /^transfer$/i,
  /^deposit$/i,
  /payoff/i,
  /pay\s+off/i,
];

// Descriptions that LOOK like payments but are actually purchases
// e.g. "Netflix Payment", "Gym Payment" — keep these as expenses
const EXPENSE_OVERRIDES = [
  /netflix/i, /spotify/i, /hulu/i, /disney/i, /amazon/i,
  /apple/i, /google/i, /gym/i, /insurance/i, /rent/i,
  /utility/i, /electric/i, /water/i, /internet/i, /phone/i,
];

export function isPaymentTransaction(description = '') {
  const desc = description.trim();
  if (EXPENSE_OVERRIDES.some(r => r.test(desc))) return false;
  return PAYMENT_PATTERNS.some(r => r.test(desc));
}
