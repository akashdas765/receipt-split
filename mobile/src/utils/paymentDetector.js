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
  // "Payment to Chase card ending in 3358 08/03" — a bank-side debit
  // description naming the destination card, not "card payment" phrasing.
  /payment\s+to\s+.*\bcard\b/i,

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

// Narrower than isPaymentTransaction(): only "you paid your bill"
// confirmations, where money is unambiguously coming INTO this card
// account. Transfers/loan payments also count as isPayment (excluded from
// spend totals) but are money leaving somewhere else, not a credit to
// this account, so they're deliberately not in this list. Used to safely
// infer isCredit for transactions whose original signed amount wasn't
// preserved (older records only ever stored a positive magnitude).
const CREDIT_CONFIRMATION_PATTERNS = [
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
];

export function isCreditConfirmation(description = '') {
  const desc = description.trim();
  if (EXPENSE_OVERRIDES.some(r => r.test(desc))) return false;
  return CREDIT_CONFIRMATION_PATTERNS.some(r => r.test(desc));
}

// Recognizes paycheck/income deposits — kept separate from
// isPaymentTransaction (which is about excluding non-spend debits, not
// classifying credits) and from isCreditConfirmation (which is about "you
// paid your own card," the opposite direction). "Pyramid Consulti" is the
// user's own employer's ACH deposit naming (bank descriptions routinely
// truncate the payer's legal name) — the generic patterns below exist so
// this isn't a single-employer hack forever if that ever changes.
const INCOME_PATTERNS = [
  /pyramid\s+consulti/i,
  /payroll/i,
  /direct\s+dep(osit)?/i,
  /\bach\s+credit\b/i,
  /\bsalary\b/i,
  /\bwages\b/i,
  /biweekly\s+pay/i,
  /pay\s+period/i,
];

export function isIncomeTransaction(description = '') {
  const desc = description.trim();
  return INCOME_PATTERNS.some(r => r.test(desc));
}
