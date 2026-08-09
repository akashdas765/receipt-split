// Detects transfers between the user's OWN accounts — a $2200 "Deposit
// from 360 Performance Savings" on Checking isn't income, it's the other
// side of a $2200 withdrawal from Savings; a Zelle payment "from Akash Das"
// (the user's own name) received on one bank is the other side of a debit
// on a different bank. Both sides get quietly counted as real income/
// expense today (and can even show up as "unmatched" in the Splitwise
// review list, since matcher.js has no way to know they're not spend).
//
// Two tiers, mirroring matcher.js's auto-match/suggest precedent:
//  - Tier 1 (findTransferPairs): both sides present in the loaded
//    transactions, paired automatically by amount+date, no confirmation
//    needed — same "greedy best-match + used set" shape as matcher.js.
//  - Tier 2 (matchAccountNameHint / matchOwnNameHint): only one side
//    present (or not yet paired), detected from the description text
//    alone. Surfaced for confirmation rather than silently applied.

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
// "not a transfer" about.
export function findTransferPairs(transactions) {
  const candidates = transactions.filter(t => !t.isPending && !t.overrideDismissedTransferHint);
  const debits  = candidates.filter(t => !t.isCredit);
  const credits = candidates.filter(t => t.isCredit);
  const used  = new Set();
  const pairs = [];

  for (const debit of debits) {
    if (used.has(debit.id)) continue;
    let best = null, bestScore = 0;
    for (const credit of credits) {
      if (used.has(credit.id) || credit.source === debit.source) continue;
      const dDiff = daysDiff(debit.date, credit.date);
      if (dDiff > MAX_DATE_DIFF_DAYS) continue;
      const amountScore = amountScoreOf(debit.amount, credit.amount);
      if (amountScore === 0) continue;
      const dateScore = dateScoreOf(dDiff);
      const descScore = jaccard(tokenize(debit.description), tokenize(credit.description));
      const total = dateScore * 0.35 + amountScore * 0.55 + descScore * 0.10;
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
// transaction's own account); 'out' means the reverse.
export function matchAccountNameHint(description, myAccountNames) {
  const desc = description || '';
  const attempts = [[desc.match(FROM_RE), 'in'], [desc.match(TO_RE), 'out']];
  for (const [m, direction] of attempts) {
    if (!m) continue;
    const captured  = stripMask(m[1]);
    const capTokens = tokenize(captured);
    const normCap   = captured.toLowerCase();
    for (const acct of myAccountNames) {
      if (!acct.rawName) continue;
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

// Orchestrator. transactions: bank txns across ALL of the user's accounts
// (not scoped to one account/card — a transfer inherently spans two).
// Each txn needs at least {id, date, amount, isCredit, isPending, source,
// sourceName, description}, plus overrideConfirmedTransfer/
// overrideDismissedTransferHint if already set.
export function detectTransfers(transactions, { myAccountNames = [], myFullName = '' } = {}) {
  const pairs = findTransferPairs(transactions);
  const pairedTxnIds = new Set();
  pairs.forEach(p => { pairedTxnIds.add(p.debit.id); pairedTxnIds.add(p.credit.id); });

  const hints = [];
  for (const txn of transactions) {
    if (pairedTxnIds.has(txn.id) || txn.isPending || txn.overrideDismissedTransferHint) continue;

    const label = txn.sourceName || txn.source;
    const acctHint = matchAccountNameHint(txn.description, myAccountNames);
    if (acctHint) {
      hints.push({
        txn,
        direction: acctHint.direction,
        matchedBy: 'account-name',
        label: acctHint.direction === 'in'
          ? `Transferred from ${acctHint.account.label} to ${label}`
          : `Transferred from ${label} to ${acctHint.account.label}`,
        confirmed: !!txn.overrideConfirmedTransfer,
      });
      continue;
    }
    if ((txn.isCredit || txn.isPayment) && matchOwnNameHint(txn.description, myFullName)) {
      hints.push({
        txn,
        direction: txn.isCredit ? 'in' : 'out',
        matchedBy: 'own-name',
        label: txn.isCredit
          ? `Possible transfer into ${label} from another of your accounts`
          : `Possible transfer out of ${label} to another of your accounts`,
        confirmed: !!txn.overrideConfirmedTransfer,
      });
    }
  }

  return { pairs, hints, pairedTxnIds };
}
