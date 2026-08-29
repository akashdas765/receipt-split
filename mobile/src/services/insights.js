import { auth } from './firebase';
import { matchTransactions, computeSummary } from '../utils/matcher';
import { detectTransfers } from '../utils/transferMatcher';
import { isPaymentTransaction } from '../utils/paymentDetector';
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

const CHAT_SYSTEM = `You are a friendly personal finance assistant inside Truespend, an app that combines receipt scanning, Splitwise, and bank statement import into one expense picture. You're given JSON for one month combining — where available — the user's scanned receipts, their full Splitwise expense history (not just receipts posted through this app), and their imported bank transactions reconciled against Splitwise (matched transactions count only the user's owed share, not the full amount). You'll see which sources contributed (hasBankData, receiptCount, transactionCount) — factor that into how confident you sound about coverage. Fields: totalSpent, mySplitwiseShare, topMerchants, topCategories (pre-aggregated sums), monthly, and itemizedTransactions — the actual line items (each with date, description, category, amount, source) behind those sums, so you CAN list or filter individual transactions (e.g. "what's in Other", "list my Splitwise expenses") instead of only reporting totals — do that whenever asked, don't claim you lack the detail when itemizedTransactions has it. Be specific and cite real numbers. If something genuinely isn't in the data (e.g. a purchase never scanned or imported at all), say so honestly instead of guessing. Keep answers concise: a few sentences or a short list, plain text, no markdown headers.`;

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
export function computeStats({ receipts, myId, myFullName = '', transactions = [], splitwiseExpenses = [] }) {
  const approved        = receipts.filter(r => r.approved);
  const pendingReceipts = receipts.filter(r => !r.approved);
  const receiptAmt      = r => r.grandTotal ?? r.total ?? 0;
  // The user's own effective spend on a receipt — personTotals[myId] once
  // it's approved and actually split (the same figure HomePage's
  // receiptShare uses), falling back to the full receipt amount while
  // pending since personTotals doesn't exist until approval and "my share"
  // genuinely isn't knowable yet. Used for the category breakdown/
  // itemized list below so a receipt split among roommates counts your
  // share there too, not the whole group's cost.
  const receiptShareAmt = r => r.approved ? (myId && r.personTotals?.[myId] || 0) : receiptAmt(r);

  const hasBankData     = transactions.length > 0;

  // Money moved between the user's own accounts (a Zelle self-transfer, a
  // bank->card bill payment) is never a "merchant" or real spend — without
  // this, something like "AKASH DAS" or "Payment to Chase card ending in
  // 3358" would show up as a top merchant. Every DETECTED candidate is
  // excluded here outright, confirmed or not — same "exclude on detection"
  // policy StatementsPage/HomePage now both use for their own totals; a
  // detected-but-unconfirmed transfer still shows in Statements' Transfers
  // tab for review, it just doesn't count as spend/income anywhere in the
  // meantime.
  const myAccountNames = session.getAllMyAccountNames();
  const typedTxns = transactions.map(t => ({ ...t, accountType: session.getAccountType(t.source) }));
  const { pairedTxnIds, hints } = detectTransfers(typedTxns, { myAccountNames, myFullName });
  const transferIds = new Set(pairedTxnIds);
  hints.forEach(h => transferIds.add(h.txn.id));
  // overrideConfirmedTransfer catches what detectTransfers can't find on
  // its own: a transaction manually confirmed as a transfer (Statements'
  // "Confirm transfer" button) or given the special "Transfers" category
  // (TransactionsList/BankTransactionDetail's category dropdown) — neither
  // is a pattern detectTransfers looks for, only a flag stamped on the doc.
  transactions.forEach(t => { if (t.overrideConfirmedTransfer) transferIds.add(t.id); });

  // isBankAccount tags checking/bank-classified Plaid txns so
  // matchTransactions() doesn't auto-match them against Splitwise (see
  // session.isBankAccountSource) — same reasoning as StatementsPage.jsx.
  // Pending transactions are excluded too — amount isn't final until they
  // post, so they shouldn't factor into spend totals or Splitwise matching
  // yet (see StatementsPage.jsx's pendingTxns for where they're surfaced).
  // isPaymentTransaction(description) is checked live here rather than
  // trusting only the stored isPayment flag — isPayment is stamped once at
  // sync time (see plaid.js), so a transaction synced before a pattern was
  // added (e.g. "Payment to Chase card ending in...") would otherwise stay
  // misclassified in Insights until someone runs Statements' "Fix payment
  // labels" reclassification. Checking live means a pattern update fixes
  // Insights immediately for every transaction, already-synced or not.
  // overridePayment (Statements' "Counts as" control) settles the payment
  // question outright when set — beating both the stored flag and the live
  // pattern check, so a user's explicit classification holds here too.
  // !isCredit must be explicit now: it used to ride along for free because
  // isPayment is stamped true on every credit at ingestion (see plaid.js),
  // but a credit reclassified as "Credit / refund" carries
  // overridePayment:false — money received, still never an expense.
  const bankExpenseTxns = transactions
    .filter(t => !t.isCredit && !(t.overridePayment ?? (t.isPayment || isPaymentTransaction(t.description))) && !t.overrideExcludedFromSpend && !t.isPending && !transferIds.has(t.id))
    .map(t => ({ ...t, isBankAccount: session.isBankAccountSource(t.source) }));
  // Always run the matcher, even with zero bank transactions — with
  // nothing to match against, every Splitwise expense just falls through
  // as "Splitwise-only" (see matchTransactions), which is exactly what we
  // want: full Splitwise history folded in even before any statement's
  // been imported, not gated behind having bank data at all.
  const matched      = matchTransactions(bankExpenseTxns, splitwiseExpenses);
  const matchSummary = computeSummary(matched); // ignores isSplitOnly rows by design — fine for savings (below), not for total spend (see bankPersonalTotal/splitwiseShareTotal)

  // Split vs personal, for the Insights "Split vs personal" chart — computed
  // from the SAME `matched` array totalSpent below is built from (not a
  // separate re-derivation from splitwiseExpenses, e.g. mySplitwiseShare),
  // so the two bars are guaranteed to sum to totalSpent by construction
  // rather than by two independent computations happening to agree. Unlike
  // matchSummary above, this does NOT skip isSplitOnly rows — a Splitwise
  // expense that never hit a bank transaction is still real spend for
  // "total spend" purposes, same reasoning HomePage's actualSpend uses
  // splitwiseSpendTotal for.
  let bankPersonalTotal = 0, splitwiseShareTotal = 0;
  matched.forEach(t => {
    if (t.isSplitwised) splitwiseShareTotal += (t.effectiveAmount || 0);
    else bankPersonalTotal += (t.effectiveAmount || 0);
  });

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
  //
  // bankPersonalTotal + splitwiseShareTotal, not matchSummary.totalEffective
  // — that field skips isSplitOnly rows by design (see above), which would
  // silently drop any Splitwise expense that never hit a bank transaction
  // (e.g. paid in cash) the moment ANY bank transaction existed this month,
  // even one unrelated to it.
  const totalSpent = hasBankData
    ? bankPersonalTotal + splitwiseShareTotal
    : mySplitwiseShare + pendingTotal;

  // Line-item detail — the one source both the chat's drill-down answers
  // ("what's in Other", "list my Splitwise transactions") AND the
  // merchant/category aggregates below are built from, so a merchant/
  // category total and "tap it to see what's behind it" (InsightsPage's
  // CategoryDetail) can never disagree about which records make it up —
  // they're the same records, just grouped differently, instead of two
  // independently-written loops that happened to (or didn't) agree. One
  // entry per receipt (not per item within it) at receiptShareAmt (your
  // split share) — everything else here is already transaction-granularity
  // (one Splitwise expense, one bank charge), so a receipt exploded into
  // its individual items at full item price both read oddly next to those
  // and overstated a split receipt's cost. postedExpenseIds (from each
  // approved receipt's own splitwise_expense_id — see ApprovePage) skips
  // a posted receipt's own Splitwise expense from the second loop so it
  // isn't listed twice — once as itself, once as the expense it created.
  //
  // id/kind: which underlying record this line item came from, so a UI
  // can navigate to it for editing (see InsightsPage's CategoryDetail
  // click-through) — not needed for the chat, but cheap to carry and
  // avoids a second, parallel "itemized but with ids" list. 'splitwise'
  // uses the expense's own id (isSplitOnly rows never touched a bank
  // transaction, so there's no transaction id to use instead). 'bank' uses
  // the transaction's own id — even for a Splitwise-matched bank row,
  // since the bank transaction is still the editable record in Statements,
  // not the Splitwise expense it's linked to. accountSource (bank only) is
  // the transaction's own `source`, so a caller can preselect the right
  // account/card filter.
  const postedExpenseIds = new Set(approved.map(r => r.splitwise_expense_id).filter(Boolean));
  const itemizedTransactions = [];
  receipts.forEach(r => {
    const amt = receiptShareAmt(r);
    if (amt <= 0) return;
    itemizedTransactions.push({
      id:          r.id,
      kind:        'receipt',
      date:        r.date || r.scanned_at?.slice(0, 10) || null,
      description: r.merchant || 'Receipt',
      category:    r.category || 'Other',
      amount:      amt,
      source:      r.approved ? 'receipt' : 'receipt (pending, not yet split)',
    });
  });
  matched.forEach(t => {
    if (postedExpenseIds.has(t.splitwiseId)) return; // already listed above via its receipt's items
    itemizedTransactions.push({
      id:            t.isSplitOnly ? t.splitwiseId : t.id,
      kind:          t.isSplitOnly ? 'splitwise' : 'bank',
      accountSource: t.source,
      date:          t.date || null,
      description:   t.description || 'Unknown',
      category:      t.category || 'Other',
      amount:        t.effectiveAmount || 0,
      source:        t.isSplitOnly ? 'Splitwise' : t.isSplitwised ? 'bank (Splitwise-matched)' : 'bank (personal)',
    });
  });
  itemizedTransactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const MAX_ITEMIZED = 300; // defensive cap — data is already month-scoped by callers
  const itemized = itemizedTransactions.slice(0, MAX_ITEMIZED);

  // Merchant/category breakdowns, grouped straight off itemizedTransactions
  // (the full, un-capped list, not the MAX_ITEMIZED-sliced `itemized`) —
  // see the comment above for why this is derived rather than a second,
  // separately-written aggregation.
  const byMerchant = {};
  const byCategory = {};
  itemizedTransactions.forEach(t => {
    byMerchant[t.description] = (byMerchant[t.description] || 0) + t.amount;
    byCategory[t.category]    = (byCategory[t.category]    || 0) + t.amount;
  });

  const topMerchants = Object.entries(byMerchant)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([merchant, amount]) => ({ merchant, amount }));

  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({ category, amount }));

  // Monthly mirrors totalSpent's logic so the two numbers stay consistent —
  // includes isSplitOnly rows now too, same fix as totalSpent above.
  const byMonth = {};
  const monthlySource = hasBankData
    ? matched.map(t => ({ date: t.date, amount: t.effectiveAmount }))
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
    bankPersonalTotal,
    splitwiseShareTotal,
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
