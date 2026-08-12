// Detects transfers between the user's OWN accounts — a $2200 "Deposit
// from 360 Performance Savings" on Checking isn't income, it's the other
// side of a $2200 withdrawal from Savings; a Zelle payment "from Akash Das"
// (the user's own name) received on one bank is the other side of a debit
// on a different bank. Both sides get quietly counted as real income/
// expense today (and can even show up as "unmatched" in the Splitwise
// review list, since matcher.js has no way to know they're not spend).
//
// Three tiers, mirroring matcher.js's auto-match/suggest precedent:
//  - Tier 1 (findTransferPairs): both sides present in the loaded
//    transactions, paired automatically by amount+date — same "greedy
//    best-match + used set" shape as matcher.js. NOTE: pairing alone is
//    NOT proof of a real transfer — two unrelated transactions on two
//    different credit cards can coincidentally land on the same round
//    amount within a few days of each other (seen in production: two $10
//    charges on different cards falsely paired). Plaid's own
//    personal_finance_category (see isTransferCategory/hasPlaidCategory
//    below) closes most of that gap when both sides are Plaid-sourced —
//    Plaid tagging neither side as a transfer rules the pair out entirely
//    before amount/date ever get a say — but a pair is still only ever a
//    *candidate* — detectTransfers marks it confirmed=false until the user
//    explicitly confirms it, exactly like Tiers 2 and 3.
//  - Tier 2 (matchAccountNameHint / matchOwnNameHint): only one side
//    present (or not yet paired), detected from the description text
//    alone. Surfaced for confirmation rather than silently applied.
//  - Tier 3 (isTransferCategory in detectTransfers' hint loop): lowest
//    priority — Plaid flagged this transaction as transfer-shaped but
//    neither Tier 1 nor Tier 2 could explain it (e.g. the other account's
//    statement isn't imported, or it's a real transfer to an account
//    outside this app entirely, like a brokerage).
// All three tiers require the same thing in the end: nothing is presented
// as a confirmed fact ("Transferred from X to Y") until the user says so.
// Until then it's shown hedged ("Possible transfer…") with Confirm/Dismiss.

const DAY_MS = 24 * 60 * 60 * 1000;

// Transfers settle fast (same-day for intra-bank, next-day for Zelle
// cross-bank) — nowhere near Splitwise's 14-day posting-lag window, so a
// tighter window here means far fewer false-positive pairings.
const MAX_DATE_DIFF_DAYS = 3;

// Symmetric and tight — a transfer's two sides are the same dollar amount,
// no "tip" asymmetry like matcher.js's Splitwise scoring. The absolute
// floor keeps sub-$100 transfers from being held to an unreasonably small
// cent tolerance from the percentage alone.
const MAX_AMOUNT_DIFF_PCT = 0.005;
const MIN_AMOUNT_DIFF_ABS = 0.50;

// The date/amount gates already do the real filtering — this threshold
// only matters when a debit has more than one same-day/same-amount credit
// candidate (e.g. two $50 transfers the same day to different accounts),
// where description similarity breaks the tie.
const AUTO_PAIR_THRESHOLD = 0.50;

function daysDiff(d1, d2) {
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  return Math.abs(t1 - t2) / DAY_MS;
}

function dateScoreOf(dDiff) {
  return Math.max(0, 1 - dDiff / MAX_DATE_DIFF_DAYS);
}

// Plaid's own intent classification (see plaid.js's syncTransactions) —
// 'TRANSFER_IN'/'TRANSFER_OUT' when Plaid itself thinks a transaction is
// money moving between accounts, as opposed to a purchase. Only present on
// Plaid-sourced transactions; CSV/PDF imports and pre-this-feature Plaid
// syncs simply don't have plaidCategory set, so hasPlaidCategory lets
// callers fall back to the amount/date-only heuristic for those instead of
// treating "no category" as "not a transfer."
function isTransferCategory(t) {
  return t.plaidCategory === 'TRANSFER_IN' || t.plaidCategory === 'TRANSFER_OUT';
}
function hasPlaidCategory(t) {
  return t.plaidCategory != null;
}

function amountScoreOf(a, b) {
  const diff = Math.abs(a - b);
  const tolerance = Math.max(MIN_AMOUNT_DIFF_ABS, Math.max(a, b) * MAX_AMOUNT_DIFF_PCT);
  if (diff > tolerance) return 0;
  return 1 - (diff / tolerance) * 0.3;
}

// Same tokenize/Jaccard shape as matcher.js's fuzzyDescScore (not exported
// there) — kept as a small tiebreaker only, since bank-generated transfer
// text on each side is often unrelated ("Deposit from X" vs "ACH Debit").
function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}
function jaccard(tokensA, tokensB) {
  const a = new Set(tokensA), b = new Set(tokensB);
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : common / union;
}

// Tier 1: greedy pairing, same "used" bookkeeping pattern as matcher.js's
// usedExpenses. Only pairs opposite-direction (isCredit) transactions from
// DIFFERENT accounts (source) — a transfer can't be both sides of itself —
// and skips pending (amount not final) and anything the user already said
// "not a transfer" about. Restricted to bank<->bank: a "transfer" is money
// moving between the user's own checking/savings accounts — a credit card
// doesn't hold a balance you move money out of, so a credit-card txn is
// never a real transfer leg (paying a card off is already handled
// separately by the Payments tab / isCreditConfirmation). Without this
// gate, two unrelated charges on two different cards can coincidentally
// land on the same round amount within a few days and get paired — the
// exact false positive seen in production (two $10 charges on different
// cards). Plaid's personal_finance_category closes most of that gap: when
// BOTH sides are Plaid-sourced (hasPlaidCategory), Plaid has already told
// us whether each one is transfer-shaped, so two ordinary purchases never
// even become a candidate pair regardless of how well amount/date line up
// — no reason to trust a coincidence when Plaid itself says neither side
// is a transfer. Transactions without category data (CSV/PDF imports, or
// Plaid syncs from before this field was captured) skip that gate and are
// scored on amount/date/description alone, same as before this existed.
export function findTransferPairs(transactions) {
  const candidates = transactions.filter(t => !t.isPending && !t.overrideDismissedTransferHint && t.accountType === 'bank');
  const debits  = candidates.filter(t => !t.isCredit);
  const credits = candidates.filter(t => t.isCredit);
  const used  = new Set();
  const pairs = [];

  for (const debit of debits) {
    if (used.has(debit.id)) continue;
    let best = null, bestScore = 0;
    for (const credit of credits) {
      if (used.has(credit.id) || credit.source === debit.source) continue;
      if (hasPlaidCategory(debit) && hasPlaidCategory(credit) && !(isTransferCategory(debit) && isTransferCategory(credit))) continue;
      const dDiff = daysDiff(debit.date, credit.date);
      if (dDiff > MAX_DATE_DIFF_DAYS) continue;
      const amountScore = amountScoreOf(debit.amount, credit.amount);
      if (amountScore === 0) continue;
      const dateScore = dateScoreOf(dDiff);
      const descScore = jaccard(tokenize(debit.description), tokenize(credit.description));
      // Corroboration bonus, not the deciding factor — 1 when Plaid tags
      // both sides as transfers, 0.5 when only one side has category data
      // to go on (the other's a CSV row), 0 otherwise. Reweighted from the
      // pre-Plaid-category formula (0.35/0.55/0.10) rather than just
      // added on top, so an uncorroborated pair still needs the same
      // amount/date strength as before to auto-pair.
      const plaidScore = (isTransferCategory(debit) && isTransferCategory(credit)) ? 1
        : (isTransferCategory(debit) || isTransferCategory(credit)) ? 0.5 : 0;
      const total = dateScore * 0.30 + amountScore * 0.45 + descScore * 0.05 + plaidScore * 0.20;
      if (total > bestScore) { bestScore = total; best = credit; }
    }
    if (best && bestScore >= AUTO_PAIR_THRESHOLD) {
      used.add(debit.id); used.add(best.id);
      pairs.push({ debit, credit: best, score: Math.round(bestScore * 100) });
    }
  }
  return pairs;
}

const FROM_RE = /\bfrom\s+([a-z0-9][a-z0-9 .]*[a-z0-9*#]*)/i;
const TO_RE   = /\bto\s+([a-z0-9][a-z0-9 .]*[a-z0-9*#]*)/i;
const stripMask = s => s.replace(/[*#]+\S*/g, '').trim();

// myAccountNames: session.getAllMyAccountNames() shape. Returns
// { direction: 'in'|'out', account } or null. direction 'in' means the
// captured name is where the money came FROM (so it's flowing IN to this
// transaction's own account); 'out' means the reverse. Only matches other
// BANK accounts — same "transfers are bank<->bank only" rule as
// findTransferPairs; a description mentioning a credit card by name isn't
// a transfer leg.
export function matchAccountNameHint(description, myAccountNames) {
  const desc = description || '';
  const attempts = [[desc.match(FROM_RE), 'in'], [desc.match(TO_RE), 'out']];
  for (const [m, direction] of attempts) {
    if (!m) continue;
    const captured  = stripMask(m[1]);
    const capTokens = tokenize(captured);
    const normCap   = captured.toLowerCase();
    for (const acct of myAccountNames) {
      if (!acct.rawName || acct.accountType !== 'bank') continue;
      const normRaw = acct.rawName.toLowerCase();
      if (normCap.includes(normRaw) || jaccard(capTokens, tokenize(acct.rawName)) >= 0.6) {
        return { direction, account: acct };
      }
    }
  }
  return null;
}

// Deliberately conservative — only meaningful for transactions that are
// already isCredit or isPayment (never fires on an ordinary debit/expense,
// since the user's own name could legitimately appear in an unrelated
// merchant description otherwise).
export function matchOwnNameHint(description, myFullName) {
  if (!myFullName) return false;
  return (description || '').toLowerCase().includes(myFullName.toLowerCase());
}

// Orchestrator. transactions: txns across ALL of the user's accounts (not
// scoped to one account/card — a transfer inherently spans two). Each txn
// needs at least {id, date, amount, isCredit, isPending, source,
// sourceName, description, accountType}, plus overrideConfirmedTransfer/
// overrideDismissedTransferHint if already set. accountType comes from
// session.getAccountType(source) — only 'bank' rows are ever considered,
// since a transfer is money moving between the user's own checking/savings
// accounts, never a credit card leg (see findTransferPairs).
export function detectTransfers(transactions, { myAccountNames = [], myFullName = '' } = {}) {
  // A pair is confirmed once the user has confirmed EITHER side (confirming
  // is done for the pair as a whole — see StatementsPage's
  // handleConfirmTransferPair, which sets the override on both).
  const pairs = findTransferPairs(transactions).map(p => ({
    ...p,
    confirmed: !!(p.debit.overrideConfirmedTransfer || p.credit.overrideConfirmedTransfer),
  }));
  const pairedTxnIds = new Set();
  pairs.forEach(p => { pairedTxnIds.add(p.debit.id); pairedTxnIds.add(p.credit.id); });

  const hints = [];
  for (const txn of transactions) {
    // Transfers are bank<->bank only (see findTransferPairs) — a hint on a
    // credit card row is never a real transfer leg.
    if (txn.accountType !== 'bank') continue;
    if (pairedTxnIds.has(txn.id) || txn.isPending || txn.overrideDismissedTransferHint) continue;

    const label = txn.sourceName || txn.source;
    const acctHint = matchAccountNameHint(txn.description, myAccountNames);
    if (acctHint) {
      const confirmed = !!txn.overrideConfirmedTransfer;
      const from = acctHint.direction === 'in' ? acctHint.account.label : label;
      const to   = acctHint.direction === 'in' ? label : acctHint.account.label;
      hints.push({
        txn,
        direction: acctHint.direction,
        matchedBy: 'account-name',
        label: confirmed ? `Transferred from ${from} to ${to}` : `Possible transfer: ${from} → ${to}`,
        confirmed,
      });
      continue;
    }
    const confirmed = !!txn.overrideConfirmedTransfer;
    if ((txn.isCredit || txn.isPayment) && matchOwnNameHint(txn.description, myFullName)) {
      hints.push({
        txn,
        direction: txn.isCredit ? 'in' : 'out',
        matchedBy: 'own-name',
        label: txn.isCredit
          ? (confirmed ? `Transferred into ${label} from another of your accounts` : `Possible transfer into ${label} from another of your accounts`)
          : (confirmed ? `Transferred out of ${label} to another of your accounts` : `Possible transfer out of ${label} to another of your accounts`),
        confirmed,
      });
    } else if (isTransferCategory(txn)) {
      // Plaid flagged this one as transfer-shaped, but findTransferPairs
      // couldn't find a matching counterpart (other account's statement
      // not imported yet, amount/date drifted past the match window, or
      // it's a real transfer to an account outside this app, e.g. a
      // brokerage). Lowest-priority tier — only surfaced when neither the
      // account-name nor own-name text heuristic already explained it.
      hints.push({
        txn,
        direction: txn.isCredit ? 'in' : 'out',
        matchedBy: 'plaid-category',
        label: txn.isCredit
          ? (confirmed ? `Transferred into ${label} from another account` : `Possible transfer into ${label} — Plaid flagged this as a transfer`)
          : (confirmed ? `Transferred out of ${label} to another account` : `Possible transfer out of ${label} — Plaid flagged this as a transfer`),
        confirmed,
      });
    }
  }

  return { pairs, hints, pairedTxnIds };
}
