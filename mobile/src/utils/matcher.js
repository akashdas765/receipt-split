import { detectCategory } from './categoryDetector';
import { parseDate } from './statementFormatters';

// Smart matching engine: pairs bank transactions with Splitwise expenses so
// "what did I actually spend" can be computed — matched → your owed share,
// unmatched → full bank amount (100% yours). Ported from
// akashdas765/personal-expense-manager's matcher.js.
//
// Adapted from the original: overrides live directly on each transaction
// object (overrideSplitwiseId / overrideForcedUnmatched / overrideExpenseData,
// persisted as Firestore fields — see services/db.js) rather than a separate
// overrides map keyed by id, so there's one Firestore doc per transaction
// instead of a second collection just for link state.

const DAY_MS              = 24 * 60 * 60 * 1000;
const MAX_DATE_DIFF_DAYS  = 5;
const MAX_AMOUNT_DIFF_PCT = 0.05;

function daysDiff(d1, d2) {
  const t1 = d1 instanceof Date ? d1.getTime() : new Date(d1).getTime();
  const t2 = d2 instanceof Date ? d2.getTime() : new Date(d2).getTime();
  return Math.abs(t1 - t2) / DAY_MS;
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

export function matchTransactions(bankTransactions, splitwiseExpenses) {
  const usedExpenses = new Set();
  const result = [];

  // Pre-pass: lock in manual overrides so they can't be stolen by auto-match
  for (const txn of bankTransactions) {
    if (txn.overrideSplitwiseId) {
      const forced = splitwiseExpenses.find(e => e.id === txn.overrideSplitwiseId);
      if (forced) usedExpenses.add(forced.id);
    }
  }

  for (const txn of bankTransactions) {
    const txnDate   = parseDate(txn.date) || new Date();
    const txnAmount = Math.abs(txn.amount || 0);

    // 1. Manual force-unmatched
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

    // 2. Manual force-matched
    if (txn.overrideSplitwiseId) {
      const forced = splitwiseExpenses.find(e => e.id === txn.overrideSplitwiseId) || txn.overrideExpenseData;
      if (forced) {
        result.push({
          ...txn,
          isSplitwised:    true,
          splitwiseId:     forced.id,
          splitwiseDesc:   forced.description,
          matchScore:      100,
          manualOverride:  true,
          originalAmount:  txnAmount,
          effectiveAmount: forced.myOwedShare,
          savings:         txnAmount - forced.myOwedShare,
          category:        txn.category || detectCategory(txn.description) || forced.category,
          groupId:         forced.group_id,
        });
        continue;
      }
    }

    // 3. Auto-match
    let bestMatch = null;
    let bestScore = 0;

    for (const exp of splitwiseExpenses) {
      if (usedExpenses.has(exp.id)) continue;

      const expDate   = parseDate(exp.date) || new Date();
      const expAmount = parseFloat(exp.cost || 0);

      const dDiff = daysDiff(txnDate, expDate);
      if (dDiff > MAX_DATE_DIFF_DAYS) continue;

      const larger  = Math.max(txnAmount, expAmount);
      const smaller = Math.min(txnAmount, expAmount);
      if (larger === 0) continue;
      const amtRatio = smaller / larger;
      if (amtRatio < (1 - MAX_AMOUNT_DIFF_PCT)) continue;

      const dateScore   = (MAX_DATE_DIFF_DAYS - dDiff) / MAX_DATE_DIFF_DAYS;
      const amountScore = amtRatio;
      const descScore   = fuzzyDescScore(txn.description, exp.description);
      const total       = dateScore * 0.25 + amountScore * 0.55 + descScore * 0.20;

      if (total > bestScore) { bestScore = total; bestMatch = exp; }
    }

    const THRESHOLD = 0.45;
    if (bestMatch && bestScore >= THRESHOLD) {
      usedExpenses.add(bestMatch.id);
      result.push({
        ...txn,
        isSplitwised:    true,
        splitwiseId:     bestMatch.id,
        splitwiseDesc:   bestMatch.description,
        matchScore:      Math.round(bestScore * 100),
        manualOverride:  false,
        originalAmount:  txnAmount,
        effectiveAmount: bestMatch.myOwedShare,
        savings:         txnAmount - bestMatch.myOwedShare,
        category:        txn.category || detectCategory(txn.description) || bestMatch.category,
        groupId:         bestMatch.group_id,
      });
    } else {
      result.push({
        ...txn,
        isSplitwised:    false,
        splitwiseId:     null,
        manualOverride:  false,
        originalAmount:  txnAmount,
        effectiveAmount: txnAmount,
        savings:         0,
        category:        txn.category || detectCategory(txn.description),
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
