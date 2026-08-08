import { auth } from './firebase';
import { matchTransactions, computeSummary } from '../utils/matcher';
import { mapReceiptCategory } from '../utils/categoryDetector';
import { session } from './session';

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

const CHAT_SYSTEM = `You are a friendly personal finance assistant inside ReceiptSplit, an app that combines receipt scanning, Splitwise, and bank statement import into one expense picture. You're given JSON for one month combining — where available — the user's scanned receipts, their full Splitwise expense history (not just receipts posted through this app), and their imported bank transactions reconciled against Splitwise (matched transactions count only the user's owed share, not the full amount). You'll see which sources contributed (hasBankData, receiptCount, transactionCount) — factor that into how confident you sound about coverage. Fields: totalSpent, mySplitwiseShare, topMerchants, topCategories (pre-aggregated sums), monthly, and itemizedTransactions — the actual line items (each with date, description, category, amount, source) behind those sums, so you CAN list or filter individual transactions (e.g. "what's in Other", "list my Splitwise expenses") instead of only reporting totals — do that whenever asked, don't claim you lack the detail when itemizedTransactions has it. Be specific and cite real numbers. If something genuinely isn't in the data (e.g. a purchase never scanned or imported at all), say so honestly instead of guessing. Keep answers concise: a few sentences or a short list, plain text, no markdown headers.`;

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
  // isBankAccount tags checking/bank-classified Plaid txns so
  // matchTransactions() doesn't auto-match them against Splitwise (see
  // session.isBankAccountSource) — same reasoning as StatementsPage.jsx.
  // Pending transactions are excluded too — amount isn't final until they
  // post, so they shouldn't factor into spend totals or Splitwise matching
  // yet (see StatementsPage.jsx's pendingTxns for where they're surfaced).
  const bankExpenseTxns = transactions
    .filter(t => !t.isPayment && !t.isPending)
    .map(t => ({ ...t, isBankAccount: session.isBankAccountSource(t.source) }));
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

  // Line-item detail, so the chat can actually answer "what's in Other" or
  // "list my Splitwise transactions" instead of only ever seeing the
  // aggregated sums above — those alone have no way to answer a drill-down
  // question since the individual entries were never in its context.
  // Receipt items give the most granular data available (each item's own
  // category, not the whole receipt as one line); everything else is at
  // expense/transaction granularity. Same postedExpenseIds dedup as above.
  const itemizedTransactions = [];
  receipts.forEach(r => {
    (r.items || []).forEach(item => {
      const amt = parseFloat(item.amount) || 0;
      if (amt <= 0) return;
      itemizedTransactions.push({
        date:        r.date || r.scanned_at?.slice(0, 10) || null,
        description: `${item.description || 'Item'} (${r.merchant || 'receipt'})`,
        category:    mapReceiptCategory(item.category),
        amount:      amt,
        source:      r.approved ? 'receipt' : 'receipt (pending, not yet split)',
      });
    });
  });
  matched.forEach(t => {
    if (postedExpenseIds.has(t.splitwiseId)) return; // already listed above via its receipt's items
    itemizedTransactions.push({
      date:        t.date || null,
      description: t.description || 'Unknown',
      category:    t.category || 'Other',
      amount:      t.effectiveAmount || 0,
      source:      t.isSplitOnly ? 'Splitwise' : t.isSplitwised ? 'bank (Splitwise-matched)' : 'bank (personal)',
    });
  });
  itemizedTransactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const MAX_ITEMIZED = 300; // defensive cap — data is already month-scoped by callers
  const itemized = itemizedTransactions.slice(0, MAX_ITEMIZED);

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
    itemizedTransactions: itemized,
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
      // gpt-oss-20b is a reasoning model — unlike qwen3.6-27b (see groq.js),
      // it doesn't support reasoning_effort: 'none', only low/medium/high,
      // and its reasoning tokens count against max_tokens same as content.
      // Left at the default (unset ≈ medium) with the itemized-transactions
      // payload added, a longer enumeration question could burn the whole
      // budget on reasoning before ever writing to `content`, coming back
      // as a silent empty reply. 'low' leaves more headroom for content.
      reasoning_effort: 'low',
      max_tokens: 1024,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    throw new Error(message || 'Could not get a response.');
  }
  const content = data.choices[0].message.content?.trim();
  if (content) return content;
  // A "successful" response with empty content previously rendered as a
  // silent, blank chat bubble — e.g. when the model spends its whole
  // max_tokens budget on the separate `reasoning` field (see above) before
  // ever writing an answer. Surface that as a real, visible error instead.
  throw new Error('The model didn\'t return an answer — try asking again, maybe more specifically.');
}
