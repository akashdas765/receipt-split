import { auth } from './firebase';
import { matchTransactions, computeSummary } from '../utils/matcher';
import { mapReceiptCategory } from '../utils/categoryDetector';

// Same auth-gated proxy groq.js uses — this just sends a text-only chat
// completion instead of an image one, so no separate function/route needed.
const PROXY = '/.netlify/functions/groq';

// Small, fast text model — good fit for chat where latency matters more
// than depth. Groq deprecates models periodically; check
// console.groq.com/docs/models if this starts 404ing.
const MODEL = 'openai/gpt-oss-20b';

// Only the last N turns are sent to the model — bounds prompt size/cost as
// a conversation grows without capping what's shown in the UI.
const MAX_HISTORY_TURNS = 10;

const CHAT_SYSTEM = `You are a friendly personal finance assistant inside ReceiptSplit, an app that combines receipt scanning, Splitwise, and bank statement import into one expense picture. You're given aggregated JSON stats that combine — where available — the user's scanned receipts, their full Splitwise expense history (not just receipts posted through this app), and their imported bank transactions reconciled against Splitwise (matched transactions count only the user's owed share, not the full amount). You'll see which sources contributed (hasBankData, receiptCount, transactionCount) — factor that into how confident you sound about coverage. Fields: total spend, the user's Splitwise share, spending by merchant, spending by category, and spending by month. Answer the user's questions using this data — be specific and cite real numbers. If something can't be answered from the data (e.g. a specific individual purchase not reflected in the aggregates), say so honestly instead of guessing. Keep answers concise: a few sentences, plain text, no markdown headers.`;

// Combines every data source this app has for "where did my money go":
//   - receipts: Firestore receipt docs scanned through this app (item-level
//     category precision, but only what was scanned here)
//   - splitwiseExpenses: full Splitwise history (see fetchAllExpenses) —
//     a receipt posted through this app already shows up in here, so it's
//     not double counted against the receipts list
//   - transactions: imported bank/manual transactions (see Statements) —
//     when present, these are reconciled against splitwiseExpenses with the
//     same matching engine the Statements page uses, so totals reflect what
//     actually left the user's accounts rather than just what was scanned
// myId: the user's own Splitwise member id (string), or undefined.
export function computeStats({ receipts, myId, transactions = [], splitwiseExpenses = [] }) {
  const approved        = receipts.filter(r => r.approved);
  const pendingReceipts = receipts.filter(r => !r.approved);
  const receiptAmt      = r => r.grandTotal ?? r.total ?? 0;

  const hasBankData     = transactions.length > 0;
  const bankExpenseTxns = transactions.filter(t => !t.isPayment);
  // Always run the matcher, even with zero bank transactions — with
  // nothing to match against, every Splitwise expense just falls through
  // as "Splitwise-only" (see matchTransactions), which is exactly what we
  // want: full Splitwise history folded in even before any statement's
  // been imported, not gated behind having bank data at all.
  const matched      = matchTransactions(bankExpenseTxns, splitwiseExpenses);
  const matchSummary = computeSummary(matched); // ignores isSplitOnly rows by design

  // Full Splitwise share — not just receipts posted through this app,
  // which is strictly narrower (misses expenses added any other way).
  let mySplitwiseShare = 0;
  let mySplitwiseShareCount = 0;
  if (myId) {
    splitwiseExpenses.forEach(e => {
      if (e.myOwedShare > 0) { mySplitwiseShare += e.myOwedShare; mySplitwiseShareCount++; }
    });
  }

  const pendingTotal = pendingReceipts.reduce((s, r) => s + receiptAmt(r), 0);

  // "Total spend" always means the user's own effective spend, never a
  // group total — bank-reconciled when a statement's been imported (covers
  // every dollar that left an account, split-adjusted), plus receipts not
  // yet posted (their real "my share" isn't knowable until someone's
  // assigned — personTotals only exists after approval — so the full
  // receipt amount is the best available figure). Once bank data exists,
  // pending receipts are assumed to already show up there as unmatched
  // personal spend, so they're left out to avoid double-counting.
  const totalSpent = hasBankData
    ? matchSummary.totalEffective
    : mySplitwiseShare + pendingTotal;

  // Merchant/category breakdowns. `matched` already covers every Splitwise
  // expense (bank-reconciled or not), including ones posted through this
  // app — so only pending (not-yet-posted) receipts get looped separately
  // for merchants; otherwise a posted receipt would count twice, once as
  // itself and once as the Splitwise expense it created. postedExpenseIds
  // (from each approved receipt's own splitwise_expense_id — see
  // ApprovePage) makes that dedup exact, including the case where the
  // matcher later links that same expense to an imported bank transaction.
  const postedExpenseIds = new Set(approved.map(r => r.splitwise_expense_id).filter(Boolean));
  const byMerchant = {};
  const byCategory = {};

  pendingReceipts.forEach(r => {
    const key = r.merchant || 'Unknown';
    byMerchant[key] = (byMerchant[key] || 0) + receiptAmt(r);
  });

  // Category uses ALL receipts (posted or not) for item-level
  // food/drink/alcohol precision — bank/Splitwise category data for the
  // same underlying spend is intentionally skipped below to avoid double
  // counting, at the cost of not knowing the category of a posted expense
  // that never came from a receipt scan. Good enough for "what am I
  // spending on", not exact to the cent.
  receipts.forEach(r => {
    (r.items || []).forEach(item => {
      const cat = mapReceiptCategory(item.category);
      const amt = parseFloat(item.amount) || 0;
      byCategory[cat] = (byCategory[cat] || 0) + amt;
    });
  });

  matched.forEach(t => {
    const key = t.description || 'Unknown';
    byMerchant[key] = (byMerchant[key] || 0) + (t.effectiveAmount || 0);
    // Skip categorizing a row that's just a posted receipt's own Splitwise
    // expense re-appearing (isSplitOnly, or later matched to a bank txn —
    // either way, same underlying spend) — already counted above via that
    // receipt's own items. Only count Splitwise/bank spend that never came
    // from a receipt scan here, under its coarser bank/Splitwise category.
    if (!postedExpenseIds.has(t.splitwiseId)) {
      byCategory[t.category || 'Other'] = (byCategory[t.category || 'Other'] || 0) + (t.effectiveAmount || 0);
    }
  });

  const topMerchants = Object.entries(byMerchant)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([merchant, amount]) => ({ merchant, amount }));

  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({ category, amount }));

  // Monthly mirrors totalSpent's logic so the two numbers stay consistent.
  const byMonth = {};
  const monthlySource = hasBankData
    ? matched.filter(t => !t.isSplitOnly).map(t => ({ date: t.date, amount: t.effectiveAmount }))
    : [
        ...matched.map(t => ({ date: t.date, amount: t.effectiveAmount })), // all isSplitOnly here
        ...pendingReceipts.map(r => ({ date: r.date || r.scanned_at?.slice(0, 10), amount: receiptAmt(r) })),
      ];
  monthlySource.forEach(({ date, amount }) => {
    if (!date) return;
    const month = date.slice(0, 7); // YYYY-MM
    byMonth[month] = (byMonth[month] || 0) + amount;
  });
  const monthly = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, amount]) => ({ month, amount }));

  return {
    receiptCount:     receipts.length,
    approvedCount:    approved.length,
    transactionCount: transactions.length,
    hasBankData,
    totalSpent,
    savingsViaSplits: matchSummary.totalSavings,
    mySplitwiseShare,
    mySplitwiseShareCount,
    hasMyShare: !!myId,
    topMerchants,
    topCategories,
    monthly,
  };
}

// messages: prior conversation as [{ role: 'user' | 'assistant', content }],
// already including the new user turn. Returns the assistant's reply text.
export async function askInsightsChat(stats, messages) {
  let idToken;
  try {
    idToken = await auth.currentUser?.getIdToken();
  } catch {
    idToken = null;
  }

  const res = await fetch(PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: `${CHAT_SYSTEM}\n\nSpending data:\n${JSON.stringify(stats)}` },
        ...messages.slice(-MAX_HISTORY_TURNS),
      ],
      max_tokens: 400,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    throw new Error(message || 'Could not get a response.');
  }
  return data.choices[0].message.content.trim();
}
