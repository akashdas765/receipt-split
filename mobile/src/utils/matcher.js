import { detectCategory } from './categoryDetector';
import { parseDate } from './statementFormatters';

// Smart matching engine: pairs bank transactions with Splitwise expenses so
// "what did I actually spend" can be computed — matched → your owed share,
// unmatched → full bank amount (100% yours). Originally ported from
// akashdas765/personal-expense-manager's matcher.js; the scoring below has
// since diverged from that source to fix real false-negatives (see the
// constants' comments) that were showing the same expense twice — once as
// an unmatched personal bank transaction, once as its Splitwise share.
//
// Overrides live directly on each transaction object (overrideSplitwiseId /
// overrideForcedUnmatched / overrideExpenseData, persisted as Firestore
// fields — see services/db.js) rather than a separate overrides map keyed
// by id, so there's one Firestore doc per transaction instead of a second
// collection just for link state.
//
// A transaction can link to MORE THAN ONE Splitwise expense — e.g. a single
// card charge that got logged as several separate Splitwise expenses
// because different people paid different chunks of it. overrideSplitwiseIds
// / overrideExpenseDataList (both arrays) are the current shape; the older
// singular overrideSplitwiseId / overrideExpenseData are still read as a
// one-element case so already-linked transactions don't need migrating.

const DAY_MS = 24 * 60 * 60 * 1000;

// How far apart a bank transaction and a Splitwise expense can be dated and
// still be considered at all. Was a hard 5-day cutoff — credit card
// transactions routinely *post* several days after the actual purchase
// (weekends/holidays easily push this past 5), so a charge posting on day 6
// was silently excluded from matching entirely, no partial credit. 14 days
// plus a linear decay (not a cliff) means a slightly-late posting still
// scores reasonably instead of vanishing outright.
const MAX_DATE_DIFF_DAYS = 14;

// A restaurant tip added after the card is swiped routinely makes the bank
// charge 15-25% *higher* than whatever amount was logged in Splitwise —
// that's a predictable pattern, not noise, so it's tolerated generously.
// The bank amount being *lower* than the Splitwise cost is less expected
// (no everyday equivalent of "reverse tipping"), so that direction keeps a
// tight tolerance instead.
const MAX_TIP_OVER_PCT   = 0.30;
const MAX_UNDER_PCT      = 0.05;

// Auto-match: linked immediately, counted as matched. Below that but above
// SUGGEST_THRESHOLD: surfaced in Review as "looks like…", one tap to
// confirm or dismiss, instead of the algorithm having to be fully certain
// on its own. Below SUGGEST_THRESHOLD: left alone, no suggestion shown.
const AUTO_MATCH_THRESHOLD = 0.65;
const SUGGEST_THRESHOLD    = 0.35;

function daysDiff(d1, d2) {
  const t1 = d1 instanceof Date ? d1.getTime() : new Date(d1).getTime();
  const t2 = d2 instanceof Date ? d2.getTime() : new Date(d2).getTime();
  return Math.abs(t1 - t2) / DAY_MS;
}

// 1 at zero days apart, decaying linearly to 0 at MAX_DATE_DIFF_DAYS —
// replaces the old hard cutoff with a soft penalty.
function dateScoreOf(dDiff) {
  return Math.max(0, 1 - dDiff / MAX_DATE_DIFF_DAYS);
}

// 1 at an exact match. Above cost (a tip): decays to ~0.7 at
// MAX_TIP_OVER_PCT, then 0 beyond. Below cost: decays to ~0.7 at
// MAX_UNDER_PCT (a much tighter band), then 0 beyond.
function amountScoreOf(txnAmount, expAmount) {
  if (expAmount <= 0) return 0;
  const diff = txnAmount - expAmount;
  if (diff >= 0) {
    const overPct = diff / expAmount;
    if (overPct > MAX_TIP_OVER_PCT) return 0;
    return 1 - (overPct / MAX_TIP_OVER_PCT) * 0.3;
  }
  const underPct = -diff / expAmount;
  if (underPct > MAX_UNDER_PCT) return 0;
  return 1 - (underPct / MAX_UNDER_PCT) * 0.3;
}

function fuzzyDescScore(a, b) {
  if (!a || !b) return 0;
  const tokenize = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const tokA = new Set(tokenize(a));
  const tokB = new Set(tokenize(b));
  let common = 0;
  for (const t of tokA) if (tokB.has(t)) common++;
  const union = new Set([...tokA, ...tokB]).size;
  return union === 0 ? 0 : common / union;
}

// Reads the (possibly multi-expense) manual link off a transaction,
// resolving each id against the live splitwiseExpenses list first and
// falling back to the locally-stored snapshot (overrideExpenseDataList /
// overrideExpenseData) for an id that fell outside fetchAllExpenses's
// date-range window (e.g. an old expense, or one just created this
// session that hasn't round-tripped through a fresh fetch yet).
function forcedLinkIds(txn) {
  return txn.overrideSplitwiseIds || (txn.overrideSplitwiseId ? [txn.overrideSplitwiseId] : []);
}
function resolveForcedLinks(txn, splitwiseExpenses) {
  const ids = forcedLinkIds(txn);
  if (!ids.length) return [];
  const snapshots = txn.overrideExpenseDataList || (txn.overrideExpenseData ? [txn.overrideExpenseData] : []);
  return ids
    .map(id => splitwiseExpenses.find(e => e.id === id) || snapshots.find(e => e.id === id))
    .filter(Boolean);
}

export function matchTransactions(bankTransactions, splitwiseExpenses) {
  const usedExpenses = new Set();
  const result = [];

  // Pre-pass: lock in manual overrides so they can't be stolen by auto-match
  for (const txn of bankTransactions) {
    for (const id of forcedLinkIds(txn)) {
      const forced = splitwiseExpenses.find(e => e.id === id);
      if (forced) usedExpenses.add(forced.id);
    }
  }

  // Second pre-pass: a single Splitwise expense can legitimately span more
  // than one bank charge — e.g. adding an item to a Walmart order after the
  // fact posts a second, separate charge against the same receipt/expense.
  // Without this, every transaction manually linked to that expense counted
  // its FULL owed share independently, so the same $23 could get counted
  // twice (once per charge) instead of split between them. This maps each
  // forced-linked expense id to every transaction that claims it (and that
  // claimant's own bank amount), so each transaction's owed share below can
  // be pro-rated by its portion of the total bank amount claimed for that
  // expense — one full share when there's a single claimant (unchanged
  // behavior), split proportionally to each transaction's amount otherwise.
  const claimantAmounts = new Map(); // expenseId -> Map<txnId, bankAmount>
  for (const txn of bankTransactions) {
    if (txn.overrideForcedUnmatched) continue;
    const forcedList = resolveForcedLinks(txn, splitwiseExpenses);
    if (!forcedList.length) continue;
    const txnAmount = Math.abs(txn.amount || 0);
    for (const f of forcedList) {
      if (!claimantAmounts.has(f.id)) claimantAmounts.set(f.id, new Map());
      claimantAmounts.get(f.id).set(txn.id, txnAmount);
    }
  }
  const shareOf = (expenseId, txnAmount) => {
    const claimants = claimantAmounts.get(expenseId);
    if (!claimants || claimants.size <= 1) return 1;
    const total = [...claimants.values()].reduce((s, a) => s + a, 0);
    return total > 0 ? txnAmount / total : 1 / claimants.size;
  };

  for (const txn of bankTransactions) {
    const txnDate   = parseDate(txn.date) || new Date();
    const txnAmount = Math.abs(txn.amount || 0);

    // 1. Manual force-unmatched — also permanently suppresses suggestions
    // for this transaction (it never reaches the auto-match/suggest logic
    // below), same as it already suppressed auto-matching.
    if (txn.overrideForcedUnmatched) {
      result.push({
        ...txn,
        isSplitwised:    false,
        splitwiseId:     null,
        manualOverride:  true,
        originalAmount:  txnAmount,
        effectiveAmount: txnAmount,
        savings:         0,
        category:        txn.category || detectCategory(txn.description),
      });
      continue;
    }

    // 2. Manual force-matched — one or more expenses (see resolveForcedLinks)
    if (forcedLinkIds(txn).length) {
      const forcedList = resolveForcedLinks(txn, splitwiseExpenses);
      if (forcedList.length) {
        const owedFor  = f => (f.myOwedShare || 0) * shareOf(f.id, txnAmount);
        const costFor  = f => (parseFloat(f.cost) || 0) * shareOf(f.id, txnAmount);
        const totalOwed = forcedList.reduce((s, f) => s + owedFor(f), 0);
        const totalCost = forcedList.reduce((s, f) => s + costFor(f), 0);
        result.push({
          ...txn,
          isSplitwised:      true,
          splitwiseId:       forcedList[0].id,
          splitwiseMatches:  forcedList.map(f => ({
            id: f.id, description: f.description, date: f.date,
            cost: costFor(f), myOwedShare: owedFor(f), group_id: f.group_id,
          })),
          splitwiseDesc:     forcedList.map(f => f.description).join(', '),
          splitwiseDate:     forcedList[0].date,
          splitwiseCost:     totalCost,
          matchScore:        100,
          manualOverride:    true,
          originalAmount:    txnAmount,
          effectiveAmount:   totalOwed,
          savings:           txnAmount - totalOwed,
          category:          txn.category || detectCategory(txn.description) || forcedList[0].category,
          groupId:           forcedList[0].group_id,
        });
        continue;
      }
    }

    // 3. Auto-match / suggest
    let bestMatch = null;
    let bestScore = 0;

    // Bank/checking accounts don't correspond to Splitwise group expenses
    // the way a credit card charge does (paychecks, rent, ATM withdrawals,
    // etc. would just produce bogus date/amount coincidences) — left
    // unscored entirely, falling through as a plain unmatched row below.
    // Same for a transaction utils/transferMatcher.js has identified as
    // money moving between the user's own accounts (transferMatcher's
    // pairs are never real Splitwise expenses either), and for a bill
    // payment / account transfer detected by isPaymentTransaction (paying
    // your own card, moving money to savings — never a Splitwise expense
    // either). All three are still shown (relabeled by the caller) rather
    // than hidden, just never scored. Manual linking (section 2,
    // overrideSplitwiseId) is unaffected — that path never reaches here,
    // so "I'll match it manually" still works regardless of any of these.
    for (const exp of ((txn.isBankAccount || txn.isTransfer || txn.isPayment) ? [] : splitwiseExpenses)) {
      if (usedExpenses.has(exp.id)) continue;
      // Only expenses I actually paid toward are plausible matches for a
      // charge on my own card — otherwise a group-mate's expense could get
      // linked to my bank transaction just because dates/amounts line up.
      if (!(exp.myPaidShare > 0)) continue;

      const expDate   = parseDate(exp.date) || new Date();
      const expAmount = parseFloat(exp.cost || 0);

      const dDiff = daysDiff(txnDate, expDate);
      if (dDiff > MAX_DATE_DIFF_DAYS) continue;

      const amountScore = amountScoreOf(txnAmount, expAmount);
      if (amountScore === 0) continue;

      const dateScore = dateScoreOf(dDiff);
      const descScore = fuzzyDescScore(txn.description, exp.description);
      // Amount carries the most weight (it's the most reliable signal) but
      // NOT so much that an exact-amount coincidence alone can clear
      // AUTO_MATCH_THRESHOLD regardless of how far apart the dates are —
      // date still has to contribute meaningfully for a high-confidence
      // auto-match, or a purely coincidental same-amount charge weeks apart
      // would auto-link to the wrong expense. Description is frequently
      // unreliable on the bank side (cryptic merchant codes vs. whatever
      // was typed into Splitwise), so it's a tiebreaker at most.
      const total = dateScore * 0.30 + amountScore * 0.55 + descScore * 0.15;

      if (total > bestScore) { bestScore = total; bestMatch = exp; }
    }

    if (bestMatch && bestScore >= AUTO_MATCH_THRESHOLD) {
      usedExpenses.add(bestMatch.id);
      result.push({
        ...txn,
        isSplitwised:    true,
        splitwiseId:     bestMatch.id,
        splitwiseMatches: [{
          id: bestMatch.id, description: bestMatch.description, date: bestMatch.date,
          cost: parseFloat(bestMatch.cost || 0), myOwedShare: bestMatch.myOwedShare || 0, group_id: bestMatch.group_id,
        }],
        splitwiseDesc:   bestMatch.description,
        splitwiseDate:   bestMatch.date,
        splitwiseCost:   parseFloat(bestMatch.cost || 0),
        matchScore:      Math.round(bestScore * 100),
        manualOverride:  false,
        originalAmount:  txnAmount,
        effectiveAmount: bestMatch.myOwedShare,
        savings:         txnAmount - bestMatch.myOwedShare,
        category:        txn.category || detectCategory(txn.description) || bestMatch.category,
        groupId:         bestMatch.group_id,
      });
    } else {
      // Below auto-match confidence but still plausible — surfaced in
      // Review as a one-tap suggestion instead of silently staying
      // unmatched (which is how the same expense used to end up counted
      // twice: once here at full amount, once as a Splitwise-only row).
      const suggestedMatch = (bestMatch && bestScore >= SUGGEST_THRESHOLD)
        ? { score: Math.round(bestScore * 100), expense: bestMatch }
        : null;
      result.push({
        ...txn,
        isSplitwised:    false,
        splitwiseId:     null,
        manualOverride:  false,
        originalAmount:  txnAmount,
        effectiveAmount: txnAmount,
        savings:         0,
        category:        txn.category || detectCategory(txn.description),
        suggestedMatch,
      });
    }
  }

  // Splitwise-only (not in any bank upload)
  for (const exp of splitwiseExpenses) {
    if (!usedExpenses.has(exp.id) && exp.myOwedShare > 0) {
      result.push({
        id:              `sw-only-${exp.id}`,
        date:            exp.date,
        description:     exp.description,
        amount:          exp.cost,
        isSplitwised:    true,
        isSplitOnly:     true,
        splitwiseId:     exp.id,
        originalAmount:  exp.cost,
        effectiveAmount: exp.myOwedShare,
        savings:         exp.cost - exp.myOwedShare,
        category:        detectCategory(exp.description) || exp.category,
        groupId:         exp.group_id,
        source:          'splitwise',
      });
    }
  }

  return result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function computeSummary(transactions) {
  let totalOriginal = 0, totalEffective = 0, totalSavings = 0, splitCount = 0, personalCount = 0;
  for (const t of transactions) {
    if (t.isSplitOnly) continue;
    totalOriginal  += t.originalAmount  || 0;
    totalEffective += t.effectiveAmount || 0;
    totalSavings   += t.savings         || 0;
    if (t.isSplitwised) splitCount++; else personalCount++;
  }
  return { totalOriginal, totalEffective, totalSavings, splitCount, personalCount };
}
