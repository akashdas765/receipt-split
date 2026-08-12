import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CreditCard, Landmark, HelpCircle, Wallet, Upload, X, RefreshCw, Loader2 } from 'lucide-react';
import { loadTransactions, addTransactions, deleteTransaction, deleteTransactionsBySource, setTransactionOverride, updateTransactionCategory, reclassifyTransactions, savePlaidConnection, TXN_MAX } from '../services/db';
import { fetchGroups, fetchCurrentUser, fetchAllExpenses } from '../services/splitwise';
import { syncPlaidConnection } from '../services/plaidSync';
import { categorizeTransactions } from '../services/categorize';
import { fetchAccounts, defaultAccountType } from '../services/plaid';
import { matchTransactions, computeSummary } from '../utils/matcher';
import { detectTransfers } from '../utils/transferMatcher';
import { getMonthRange, formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { isPaymentTransaction, isIncomeTransaction, isCreditConfirmation } from '../utils/paymentDetector';
import { session } from '../services/session';
import { useToast } from '../components/ToastProvider';
import StatementUpload from '../components/StatementUpload';
import PlaidConnect from '../components/PlaidConnect';
import ManualEntryForm from '../components/ManualEntryForm';
import TransactionsList from '../components/TransactionsList';
import StatementsReports from '../components/StatementsReports';
import SplitwisePickerModal from '../components/SplitwisePickerModal';
import AddToSplitwiseModal from '../components/AddToSplitwiseModal';
import AccountsOverview from '../components/AccountsOverview';
import TransfersList from '../components/TransfersList';
import BottomNav from '../components/BottomNav';
import MonthSlider from '../components/MonthSlider';
import PageHeader from '../components/PageHeader';
import StatBreakdown from '../components/StatBreakdown';

const INDIGO = '#6366f1';

// accountFilter is either a specific transaction source id, or a
// 'group:bank' | 'group:credit' | 'group:other' scope — bank accounts and
// cards are never mixed into one "everything" view since their debit/
// credit meaning is different (a bank debit is money leaving you, a card
// debit is money you owe), so there's no blanket "all accounts" option.
function matchesAccountFilter(source, filter) {
  if (filter.startsWith('group:')) {
    const key = filter.slice(6);
    const type = session.getAccountType(source);
    if (key === 'bank')   return type === 'bank';
    if (key === 'credit') return type === 'credit';
    return !type; // 'other' — uncategorized sources
  }
  return source === filter;
}

// 'Upload' isn't a tab — connecting a bank / dropping a statement isn't
// something you switch to and browse, it's a one-off action, so it lives
// behind its own "Add" button (opens a bottom sheet) instead of competing
// for space with the tabs you actually flip between day to day.
//
// 'Transactions' replaces the old separate 'Review' + 'All' tabs — one
// list of every card transaction (credit or debit) for the month, with
// the Splitwise match-review workflow available as a filter within it
// instead of a whole separate tab.
//
// 'Transfers' — money moving between the user's OWN accounts (e.g. Capital
// Savings -> Capital Checking, or a Zelle payment to themselves across
// banks) isn't spend or income, but nothing about a raw bank feed says so.
// See utils/transferMatcher.js for the detection/pairing logic.
const TABS = ['Manual', 'Transactions', 'Reports', 'Payments', 'Transfers'];

export default function StatementsPage() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  // Deep-link target from InsightsPage's category drill-down (a bank
  // transaction row there navigates here with { openTxnId, accountSource,
  // date } in location.state) — kept in its own state (not read from
  // location.state directly) so it survives the state-clearing navigate()
  // below and keeps working across re-renders/tab switches.
  const [pendingOpenTxnId, setPendingOpenTxnId] = useState(location.state?.openTxnId || null);

  const [transactions, setTransactions] = useState([]);
  const [loadingTxns,  setLoadingTxns]  = useState(true);

  const [groups, setGroups] = useState([]);
  const [myId,   setMyId]   = useState(null);
  const [myFullName, setMyFullName] = useState(''); // for transferMatcher.js's own-name hint (e.g. "Zelle payment from Akash Das")

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [swExpenses,   setSwExpenses]   = useState([]);
  const [swPayments,   setSwPayments]   = useState([]);
  const [loadingSw,    setLoadingSw]    = useState(true);
  const [swError,      setSwError]      = useState('');

  const [tab,    setTab]    = useState(1); // 'Transactions' — Upload moved out of the tab bar, so it's no longer the default landing tab
  const [picker, setPicker] = useState(null); // txn being linked, or null
  const [addNewTarget, setAddNewTarget] = useState(null); // txn getting a brand-new Splitwise expense, or null
  const [uploadOpen, setUploadOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [statBreakdown, setStatBreakdown] = useState(null); // { title, transactions, getAmount, total } | null — see StatBreakdown.jsx

  // Which loaded statement/account to scope the page to — a 'group:bank' /
  // 'group:credit' / 'group:other' scope, or a specific `source` id. Each
  // connected card (Plaid) or uploaded file gets its own source — see
  // AccountsOverview.jsx for the grouped bank/credit view this doubles as
  // a drill-down target for.
  const [accountFilter, setAccountFilter] = useState('group:bank');

  // Tracks Plaid connections currently being auto-fixed (see the
  // legacy-source effect below) so a re-render mid-fix doesn't fire a
  // second concurrent resync for the same connection.
  const autoFixingRef = useRef(new Set());
  // Same concurrency guard, for the account-type backfill effect below.
  const accountTypeFixingRef = useRef(new Set());
  // Same concurrency guard, for the payment/income reclassification effect
  // below — prevents a re-render mid-fix from firing a second concurrent
  // batch write for the same set of stale rows.
  const reclassifyingRef = useRef(false);

  const groupName = id => groups.find(g => g.id === id)?.name;
  const monthRange = useMemo(() => getMonthRange(currentMonth), [currentMonth]);

  // Applies an incoming deep-link once: switches to the Transactions tab,
  // scopes to the right account/card, and jumps to the transaction's own
  // month so it's actually in the currently-loaded range (Statements and
  // Insights track month independently). Clears location.state right after
  // (navigate replace) so a later back/forward or refresh on this route
  // doesn't keep re-applying it — pendingOpenTxnId itself is separate local
  // state, so TransactionsList still gets it to expand/scroll to.
  useEffect(() => {
    const st = location.state;
    if (!st?.openTxnId) return;
    setTab(1);
    if (st.accountSource) setAccountFilter(st.accountSource);
    if (st.date) {
      const [y, m] = st.date.split('-').map(Number);
      if (y && m) setCurrentMonth(new Date(y, m - 1, 1));
    }
    setPendingOpenTxnId(st.openTxnId);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // ── Initial load: transactions + groups + current Splitwise user ─────────
  useEffect(() => {
    (async () => {
      setLoadingTxns(true);
      const [txns] = await Promise.all([loadTransactions()]);
      setTransactions(txns);
      setLoadingTxns(false);
    })();

    fetchGroups().then(setGroups).catch(() => toast.error('Could not load your Splitwise groups'));
    fetchCurrentUser()
      .then(u => { setMyId(u.id); setMyFullName([u.name, u.lastName].filter(Boolean).join(' ')); })
      .catch(() => {});
  }, []);

  // ── Splitwise expenses for the selected month ─────────────────────────────
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    (async () => {
      setLoadingSw(true); setSwError('');
      try {
        const { expenses, paymentsReceived } = await fetchAllExpenses(myId, {
          datedAfter:  monthRange.start,
          datedBefore: monthRange.end,
        });
        if (!cancelled) { setSwExpenses(expenses); setSwPayments(paymentsReceived); }
      } catch (err) {
        if (!cancelled) setSwError(err?.message || 'Could not load Splitwise expenses.');
      } finally {
        if (!cancelled) setLoadingSw(false);
      }
    })();
    return () => { cancelled = true; };
  }, [myId, monthRange.start, monthRange.end]);

  // ── Derived data ───────────────────────────────────────────────────────────
  // Scoped to the selected statement/account or bank-vs-credit group —
  // computed off the full list so switching the filter never has to re-fetch.
  const scopedTransactions = useMemo(() =>
    transactions.filter(t => matchesAccountFilter(t.source, accountFilter)),
    [transactions, accountFilter]
  );

  const monthlyTransactions = useMemo(() =>
    scopedTransactions.filter(t => t.date && t.date.slice(0, 10) >= monthRange.start && t.date.slice(0, 10) <= monthRange.end),
    [scopedTransactions, monthRange]
  );
  // isBankAccount tags a checking/bank-classified Plaid txn so
  // matchTransactions() skips auto-matching it against Splitwise (see
  // session.isBankAccountSource) — manual linking still works regardless.
  // Pending transactions are excluded here too — their amount isn't final
  // yet, so matching/counting them against Splitwise now could need
  // unwinding once they post (or vanish, if the pending charge is
  // cancelled) — see pendingTxns below for where they do show up.

  // ── Transfers (money between the user's OWN accounts) ──────────────────────
  // Scanned across ALL accounts (transactions, not scopedTransactions — a
  // transfer inherently spans two accounts, so it must stay detectable
  // regardless of which single-account filter chip happens to be active),
  // widened ±3 days past the visible month (matching
  // transferMatcher's MAX_DATE_DIFF_DAYS) so a pair straddling a month
  // boundary (debit Jul 31, credit Aug 2) is still found — each month's own
  // independent scan will deterministically reconstruct the same pair and
  // agree on excluding both sides from its own bucket.
  const transferScanTxns = useMemo(() => {
    const pad = (dateStr, days) => {
      const d = new Date(`${dateStr}T00:00:00`);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const start = pad(monthRange.start, -3);
    const end   = pad(monthRange.end, 3);
    return transactions
      .filter(t => t.date && t.date.slice(0, 10) >= start && t.date.slice(0, 10) <= end)
      .map(t => ({ ...t, accountType: session.getAccountType(t.source) }));
  }, [transactions, monthRange]);

  // Cheap proxy trigger: Plaid connections don't change independent of a
  // transactions change (connecting/disconnecting a bank always adds or
  // removes transactions too), so recomputing this off `transactions`
  // avoids needing a separate "connections changed" signal.
  const myAccountNames = useMemo(() => session.getAllMyAccountNames(), [transactions]);

  const { pairs: transferPairs, hints: transferHints, pairedTxnIds: transferPairedIds } = useMemo(
    () => detectTransfers(transferScanTxns, { myAccountNames, myFullName }),
    [transferScanTxns, myAccountNames, myFullName]
  );

  // Every detected transfer (paired or hinted, confirmed or not) stays
  // fully visible in its normal bucket instead of being removed — hiding
  // rows made the Transactions tab disagree with what a real bank
  // statement shows (a transfer that's genuinely there just... wasn't).
  // Labeled wherever it appears instead (see bankExpenseTxns/
  // paymentsMade/paymentsReceived below); matcher.js separately skips scoring
  // isTransfer rows against Splitwise, same as it already does for
  // isBankAccount rows. Both sides of a pair get the identical label so
  // it reads the same regardless of which account you're viewing it from.
  const transferLabelById = useMemo(() => {
    const map = new Map();
    transferPairs.forEach(p => {
      const from = p.debit.sourceName || p.debit.source;
      const to   = p.credit.sourceName || p.credit.source;
      const label = p.confirmed ? `Transferred from ${from} to ${to}` : `Possible transfer: ${from} → ${to}`;
      map.set(p.debit.id, label);
      map.set(p.credit.id, label);
    });
    transferHints.forEach(h => map.set(h.txn.id, h.label));
    return map;
  }, [transferPairs, transferHints]);

  const transferPairsThisMonth = useMemo(() =>
    transferPairs.filter(p => p.debit.date.slice(0, 10) >= monthRange.start && p.debit.date.slice(0, 10) <= monthRange.end),
    [transferPairs, monthRange]
  );
  const transferHintsThisMonth = useMemo(() =>
    transferHints.filter(h => h.txn.date.slice(0, 10) >= monthRange.start && h.txn.date.slice(0, 10) <= monthRange.end),
    [transferHints, monthRange]
  );
  const unconfirmedTransferCt = useMemo(() =>
    transferPairsThisMonth.filter(p => !p.confirmed).length + transferHintsThisMonth.filter(h => !h.confirmed).length,
    [transferPairsThisMonth, transferHintsThisMonth]
  );

  // Every settled DEBIT this month, period — this (and matched, which wraps
  // it) is the ledger the "All" filter in the Transactions tab draws from,
  // so it can't drop rows just because they're a bill payment/transfer
  // (isPayment). Those still need to stay OUT of spend totals and
  // Splitwise auto-matching (matcher.js's Section 3 skip now checks
  // isPayment too) — but "not spend" and "not shown" are different things,
  // and only the former is actually true for a real transaction that
  // genuinely happened on this account. Credits are excluded here (not via
  // the old isPayment flag, which happened to also be true for every
  // credit — see plaid.js — but directly via isCredit) since they're
  // already the paymentsReceived/creditTxns list's job to show.
  const bankExpenseTxns   = useMemo(() =>
    monthlyTransactions
      .filter(t => !t.isCredit && !t.isPending)
      .map(t => ({
        ...t,
        isBankAccount: session.isBankAccountSource(t.source),
        isTransfer: transferLabelById.has(t.id),
        transferHintLabel: transferLabelById.get(t.id),
      })),
    [monthlyTransactions, transferLabelById]
  );
  // Payments tab: simple sign-based split, not pattern matching — every
  // settled transaction this month is either money received (a credit) or
  // money paid out (a debit), full stop. Replaces the old isCreditConfirmation
  // guesswork (which tried to tell a card "payment thank you" apart from a
  // plain merchant refund and needed its own confirm/dismiss step to do it).
  // Transfers never count as either — same "only exclude once actually
  // confirmed" policy used everywhere else in this file (an unconfirmed
  // transfer candidate still counts here until confirmed in the Transfers
  // tab), and pending is excluded since the amount isn't final yet.
  const paymentsReceived = useMemo(() =>
    monthlyTransactions
      .filter(t => t.isCredit && !t.isPending && !t.overrideConfirmedTransfer)
      .map(t => ({ ...t, isTransfer: transferLabelById.has(t.id), transferHintLabel: transferLabelById.get(t.id) })),
    [monthlyTransactions, transferLabelById]
  );
  // In cards mode (viewing a single credit card or "All Cards"), "money
  // paid out" isn't the interesting question — a card's own purchases
  // already show up elsewhere (Actual spend). What you actually paid
  // TOWARD the card shows up as a CREDIT on its statement ("Payment Thank
  // You-Mobile"), so isCardsView switches paymentsMade to count those
  // instead of the plain sign-based debit split bank accounts use.
  const isCardsView = accountFilter.startsWith('group:')
    ? accountFilter !== 'group:bank'
    : session.getAccountType(accountFilter) !== 'bank';
  const paymentsMade = useMemo(() =>
    monthlyTransactions
      .filter(t => isCardsView
        ? (t.isCredit && !t.isPending && isCreditConfirmation(t.description))
        : (!t.isCredit && !t.isPending && !t.overrideConfirmedTransfer))
      .map(t => ({ ...t, isTransfer: transferLabelById.has(t.id), transferHintLabel: transferLabelById.get(t.id) })),
    [monthlyTransactions, transferLabelById, isCardsView]
  );
  // "Actual Credit" — money that came in but wasn't already accounted for
  // elsewhere: paymentsReceived already excludes confirmed transfers, this
  // additionally drops card-payment credits (a credit card's own "payment
  // thank you" bill-payoff credit — isCreditConfirmation, not t.isPayment,
  // since the latter is stamped true on EVERY credit at ingestion, see
  // plaid.js/csvParser.js) and isIncome rows (paychecks — those already get
  // their own Income card below, so counting them here too would double
  // them up). What's left is refunds, cashback, reimbursements — "extra"
  // money in, not salary and not paying yourself back.
  const actualCreditTxns  = useMemo(() => paymentsReceived.filter(t => !isCreditConfirmation(t.description) && !t.isIncome), [paymentsReceived]);
  const actualCreditTotal = useMemo(() => actualCreditTxns.reduce((s, t) => s + (t.amount || 0), 0), [actualCreditTxns]);
  // Same isCredit-not-isPayment reasoning as bankExpenseTxns above — a
  // pending bill payment/transfer debit still belongs in the ledger.
  // Pending credits are left out here (unchanged from before): they'd need
  // DebitRow to render with credit sign/styling, which it doesn't do today
  // — a separate gap from the one being fixed here.
  const pendingTxns = useMemo(() => monthlyTransactions.filter(t => t.isPending && !t.isCredit), [monthlyTransactions]);

  // Spend/expense TOTALS still exclude transfers (a transfer was never
  // spend, however visible it stays in the actual transaction list) — used
  // by the stat bar below instead of bankExpenseTxns directly. Excludes only
  // CONFIRMED transfers (overrideConfirmedTransfer), not just detected ones
  // (isTransfer) — same "don't change a total before confirmation" policy
  // accountSummary/paymentsMade/paymentsReceived already use below. An
  // unconfirmed candidate that turns out to be a false positive (two
  // unrelated charges that coincidentally matched) would otherwise vanish
  // from "Actual spend" the moment it's detected, before the user ever gets
  // a chance to dismiss it as "not a transfer" in the Transfers tab. Also
  // excludes isPayment (bill payments/account transfers) — bankExpenseTxns
  // now includes those for ledger completeness (see its own comment), but
  // paying your own card bill or moving money to savings still isn't spend.
  const realExpenseTxns = useMemo(() => bankExpenseTxns.filter(t => !t.isPayment && !t.overrideConfirmedTransfer), [bankExpenseTxns]);

  // Account-aware Debit/Credit/Net summary — deliberately computed from the
  // RAW month(+account)-scoped transaction list, not bankExpenseTxns/
  // paymentsMade/paymentsReceived (which exclude confirmed transfers for
  // Splitwise-matching purposes). A real bank statement counts a transfer-out as a
  // debit and a transfer-in as a credit, so this reads isCredit straight
  // off monthlyTransactions instead, which already carries transfers with
  // their correct direction. Pending excluded (amount isn't final yet).
  const statements = useMemo(() => {
    const map = {};
    for (const t of transactions) {
      const key = t.source;
      if (!key) continue;
      if (!map[key]) map[key] = { id: key, name: t.sourceName || key, count: 0 };
      map[key].count++;
    }
    return Object.values(map);
  }, [transactions]);

  const accountSummary = useMemo(() => {
    // monthlyTransactions is already scoped to accountFilter (via
    // scopedTransactions above), so scopePredicate here only decides which
    // transfer pairs/hints count toward the "Transfers" line, not which
    // transactions get summed into debit/credit.
    const computeFor = (txns, scopePredicate) => {
      const settled = txns.filter(t => !t.isPending);
      // Confirmed transfers are excluded from BOTH debit and credit — money
      // moving out to another of your own accounts was never really a
      // debit (nothing left your net worth), and money moving in from one
      // was never really a credit, same reason a confirmed card payment
      // isn't real credit. overrideConfirmedTransfer is stamped directly on
      // the transaction doc once confirmed (either side of a pair, or a
      // hint), so checking it here needs no cross-reference back to
      // transferPairsThisMonth/transferHintsThisMonth. Unconfirmed
      // candidates stay counted until the user actually confirms one, same
      // "don't change a total before confirmation" policy used everywhere
      // else in this file.
      const debitTxns  = settled.filter(t => !t.isCredit && !t.overrideConfirmedTransfer);
      // This is a ledger view (mirrors the real card/bank statement for
      // this account), so every credit counts here — including card
      // payments — unlike the Statements stat bar's "Actual Credit" card,
      // which deliberately excludes those to answer a different question
      // ("how much real money came in this month"). Only confirmed
      // transfers are excluded — money moving in from one of your own
      // accounts was never really a credit either.
      const creditTxns = settled.filter(t => t.isCredit && !t.overrideConfirmedTransfer);
      const debit  = debitTxns.reduce((s, t) => s + (t.amount || 0), 0);
      const credit = creditTxns.reduce((s, t) => s + (t.amount || 0), 0);
      const inScope = scopePredicate;
      const transferPairAmt = transferPairsThisMonth
        .filter(p => p.confirmed && (inScope(p.debit.source) || inScope(p.credit.source)))
        .reduce((s, p) => s + p.debit.amount, 0);
      const transferHintAmt = transferHintsThisMonth
        .filter(h => h.confirmed && inScope(h.txn.source))
        .reduce((s, h) => s + h.txn.amount, 0);
      // debitTxns/creditTxns exposed alongside the sums so the Debit/Credit
      // boxes in TransactionsList's SummaryCard can drill down into exactly
      // what makes up each number (see StatBreakdown.jsx) — not just for
      // display, the actual filtered list the total was computed from.
      return { debit, credit, debitTxns, creditTxns, net: credit - debit, transfers: transferPairAmt + transferHintAmt };
    };

    if (!accountFilter.startsWith('group:')) {
      const type = session.getAccountType(accountFilter);
      const stmt = statements.find(s => s.id === accountFilter);
      return {
        type: type === 'bank' ? 'bank' : 'card',
        title: stmt?.name || (type === 'bank' ? 'Bank Account' : 'Card'),
        ...computeFor(monthlyTransactions, s => s === accountFilter),
      };
    }
    const groupKey = accountFilter.slice(6); // 'bank' | 'credit' | 'other'
    return {
      type: groupKey === 'bank' ? 'bank' : 'card',
      title: groupKey === 'bank' ? 'All Bank Accounts' : groupKey === 'credit' ? 'All Cards' : 'Uncategorized',
      ...computeFor(monthlyTransactions, s => matchesAccountFilter(s, accountFilter)),
    };
  }, [monthlyTransactions, accountFilter, transferPairsThisMonth, transferHintsThisMonth, statements]);

  // matched includes isTransfer rows (matcher.js just never scores them —
  // see its Section 3 skip) so they still render in the Transactions tab;
  // computeSummary excludes only CONFIRMED transfers (same reasoning as
  // realExpenseTxns above) since "My actual spend" must not count a
  // transfer as spend once it's actually confirmed as one, but shouldn't
  // silently drop an unconfirmed candidate before the user's had a chance
  // to review it — plus isPayment rows, same as realExpenseTxns.
  const matched = useMemo(() => matchTransactions(bankExpenseTxns, swExpenses), [bankExpenseTxns, swExpenses]);
  const matchedBankOnly = useMemo(() => matched.filter(t => !t.isSplitOnly), [matched]);
  // Run the same matcher over pending transactions, kept separate from
  // `matched` (and everything derived from it — stat-bar totals,
  // accountSummary — all deliberately still exclude pending, see
  // accountSummary's comment above) so this only adds link/unlink capability
  // and match display to the Pending rows themselves, without pending
  // amounts leaking into any settled-only total. Needs the same
  // isBankAccount/isTransfer enrichment bankExpenseTxns gets — matcher.js
  // reads both as input to skip transactions that were never matchable in
  // the first place (a pending checking-account debit, a pending transfer
  // between your own accounts), not just settled ones.
  // matchTransactions also appends a synthetic isSplitOnly row for every
  // unmatched Splitwise expense (see matcher.js) — matchedBankOnly already
  // filters those out for the settled list above; this needs the same
  // filter, or every Splitwise expense not matched within *this* call
  // (a separate matchTransactions call, so it has no idea what the settled
  // call already matched) shows up as a phantom "pending" row, and since
  // those rows are sourced straight from swExpenses (no `source`, no
  // account), they're identical no matter which account filter is active.
  const matchedPending = useMemo(() => matchTransactions(
    pendingTxns.map(t => ({
      ...t,
      isBankAccount: session.isBankAccountSource(t.source),
      isTransfer: transferLabelById.has(t.id),
      transferHintLabel: transferLabelById.get(t.id),
    })),
    swExpenses
  ).filter(t => !t.isSplitOnly), [pendingTxns, swExpenses, transferLabelById]);
  const summary = useMemo(() => computeSummary(matched.filter(t => !t.isPayment && !t.overrideConfirmedTransfer)), [matched]);
  // Net spend — Actual spend minus Actual Credit (both defined above). Not
  // its own drill-down list (it's a difference of two totals, not a
  // filtered transaction set) — the two cards it's built from are each
  // already one tap away for the breakdown.
  const netSpendTotal = summary.totalEffective - actualCreditTotal;
  // Exact same filter computeSummary applies internally (it skips isSplitOnly
  // rows itself, but doesn't exclude them from its input) — this is the
  // drill-down list for "Actual spend"/"Amount saved via splits", kept in
  // sync with summary by construction rather than recomputed separately.
  const spendBreakdownTxns = useMemo(() =>
    matched.filter(t => !t.isPayment && !t.overrideConfirmedTransfer && !t.isSplitOnly),
    [matched]
  );

  const splitwiseOwed = useMemo(() => swExpenses.reduce((s, e) => s + (e.myOwedShare || 0), 0), [swExpenses]);
  const personalTotal = useMemo(() =>
    matched.filter(t => !t.isSplitwised && !t.isSplitOnly).reduce((s, t) => s + (t.effectiveAmount || 0), 0),
    [matched]
  );

  // Loaded statements, derived from ALL transactions (not just this month) —
  // grouped by `source`, labeled with the sourceName stamped on upload.
  // Same month scoping as monthlyTransactions, but NOT narrowed by
  // accountFilter — AccountsOverview needs every account's this-month
  // activity simultaneously (to show all of them at once), not just
  // whichever single account happens to be selected in the page's own
  // filter right now.
  const monthlyTransactionsAllAccounts = useMemo(() =>
    transactions.filter(t => t.date && t.date.slice(0, 10) >= monthRange.start && t.date.slice(0, 10) <= monthRange.end),
    [transactions, monthRange]
  );

  const paymentsMadeTotal     = paymentsMade.reduce((s, t) => s + (t.amount || 0), 0);
  const paymentsReceivedTotal = paymentsReceived.reduce((s, t) => s + (t.amount || 0), 0);
  // A subset of paymentsReceived, not a replacement — income transactions
  // stay in paymentsReceived too (same "a transaction can belong to more
  // than one view" pattern already used for regular purchases showing in
  // both the Transactions and Payments tabs), so the ledger stays complete
  // while this gives income its own distinct total and section.
  const incomeTxns  = useMemo(() => paymentsReceived.filter(t => t.isIncome), [paymentsReceived]);
  const incomeTotal = incomeTxns.reduce((s, t) => s + (t.amount || 0), 0);
  // Excludes transfers and payments — the "needs your attention" badge
  // shouldn't count rows that were never Splitwise-matchable to begin with
  // (same reasoning as excluding them from realExpenseTxns above).
  const unmatchedCt  = matchedBankOnly.filter(t => !t.isSplitwised && !t.isTransfer && !t.isPayment).length;

  // Transactions saved before their description was checked against the
  // payment/income patterns (isPayment/isIncome are stamped once at write
  // time, not recomputed live) — surfaced so the user can fix them without
  // a full re-sync/re-upload. Checked across ALL loaded transactions, not
  // just this month, since a stale row could be from any past statement.
  const fixableCount = useMemo(() =>
    transactions.filter(t =>
      (!t.isPayment && isPaymentTransaction(t.description)) ||
      (t.isCredit && !t.isIncome && isIncomeTransaction(t.description))
    ).length,
    [transactions]
  );

  // ── Mutations ──────────────────────────────────────────────────────────────
  // Upserts by id rather than blind-appending: a Plaid full-history re-sync
  // (see PlaidConnect.jsx's "Re-split older transactions by card") re-adds
  // transactions already in state to re-tag their source/accountId, and
  // addTransactions merges those fields server-side rather than overwriting
  // — this keeps local state consistent with that (no duplicate rows, and
  // any overrideSplitwiseId/etc. already applied locally survives).
  const handleAdd = useCallback(async (newTxns, sourceName) => {
    // Manual entries already have a full category dropdown (see
    // ManualEntryForm.jsx) — no AI call needed, and running one would just
    // add latency to a single-row "Add transaction" click for no benefit.
    // Everything else (Plaid/CSV/PDF) arrives with only a keyword-detected
    // category, so refine those with an AI batch call before writing.
    // Never blocks/fails the add itself — categorizeTransactions degrades
    // to the existing keyword detection per-transaction if the call fails.
    let txnsToAdd = newTxns;
    if (sourceName !== 'Manual entry' && newTxns.length) {
      const categories = await categorizeTransactions(newTxns.map(t => ({ id: t.id, description: t.description, amount: t.amount })));
      txnsToAdd = newTxns.map(t => ({ ...t, category: categories.get(t.id) || t.category }));
    }
    await addTransactions(txnsToAdd, sourceName);
    const uploadedAt = new Date().toISOString();
    setTransactions(prev => {
      const byId = new Map(prev.map(t => [t.id, t]));
      for (const t of txnsToAdd) {
        byId.set(t.id, { ...byId.get(t.id), ...t, sourceName, uploadedAt });
      }
      return Array.from(byId.values());
    });
  }, []);

  // Header "Sync" button — runs every connected account's sync in one tap
  // instead of opening the Add sheet and driving PlaidConnect's per-
  // connection tabs one at a time. Always full:true (re-pulls each
  // connection's whole history, re-tagging every transaction by card) rather
  // than a plain incremental sync — full is already a superset of a plain
  // sync's result (see plaidSync.js), so running both back to back would
  // just re-fetch the same data twice for no benefit.
  const handleSyncAll = async () => {
    const connections = session.getPlaidConnections();
    if (!connections.length || syncingAll) return;
    setSyncingAll(true);
    let failures = 0;
    for (const conn of connections) {
      try {
        const { cursor } = await syncPlaidConnection(conn, { full: true, onAdd: handleAdd });
        session.upsertPlaidConnection({ itemId: conn.itemId, cursor });
        await savePlaidConnection({ itemId: conn.itemId, cursor });
      } catch (err) {
        failures++;
        console.error(`Sync failed for Plaid connection ${conn.itemId}:`, err);
      }
    }
    setSyncingAll(false);
    if (failures) toast.error(`Synced with ${failures} account${failures !== 1 ? 's' : ''} failing — try again`);
    else toast.success('Accounts synced');
  };

  // Auto-fixes transactions still carrying the pre-per-account-split source
  // format (`plaid-${itemId}`, no accountId suffix — from before this app's
  // Plaid integration split one login's transactions apart by card). Those
  // rows never match any account's `plaid-${itemId}-${accountId}` pattern,
  // so session.getAccountType silently treats them as credit-eligible
  // regardless of their real account, and they show up as a phantom extra
  // "card" in the filter chips alongside the correctly-split ones. Runs a
  // full re-sync (same mechanism as PlaidConnect.jsx's manual "Re-split"
  // button) the moment legacy rows are detected, instead of leaving this
  // buried behind a button the user has to find. Silent by design — this
  // is a data-correctness fix, not something that needs a banner — but
  // failures are logged so they're not entirely invisible.
  useEffect(() => {
    if (loadingTxns) return;
    for (const conn of session.getPlaidConnections()) {
      const legacySource = `plaid-${conn.itemId}`;
      const hasLegacy = transactions.some(t => t.source === legacySource);
      if (!hasLegacy || autoFixingRef.current.has(conn.itemId)) continue;
      autoFixingRef.current.add(conn.itemId);
      (async () => {
        try {
          const { cursor } = await syncPlaidConnection(conn, { full: true, onAdd: handleAdd });
          session.upsertPlaidConnection({ itemId: conn.itemId, cursor });
          await savePlaidConnection({ itemId: conn.itemId, cursor });
        } catch (err) {
          console.error(`Auto re-split failed for Plaid connection ${conn.itemId}:`, err);
        } finally {
          autoFixingRef.current.delete(conn.itemId);
        }
      })();
    }
  }, [transactions, loadingTxns, handleAdd]);

  // Backfills accountType for Plaid accounts that already have a stored
  // `accounts` entry (name/mask) but were never classified bank-vs-credit —
  // PlaidConnect.jsx's own backfill only fires when a connection's accounts
  // list is entirely EMPTY, so an account added before the classification
  // system existed but already present in `accounts` (e.g. from Link's
  // onSuccess metadata) falls through the gap and stays permanently
  // unclassified, showing up as "Other" in the filter chips even though
  // it's a real credit card. Fetches Plaid's live account list once per
  // connection and fills in just the missing entries, leaving anything
  // already classified (including a manual correction) untouched.
  useEffect(() => {
    if (loadingTxns) return;
    for (const conn of session.getPlaidConnections()) {
      const accounts = conn.accounts || [];
      const needsFix = accounts.length > 0 && accounts.some(a => !a.accountType);
      if (!needsFix || accountTypeFixingRef.current.has(conn.itemId)) continue;
      accountTypeFixingRef.current.add(conn.itemId);
      (async () => {
        try {
          const rawAccounts = await fetchAccounts(conn.accessToken);
          const rawById = new Map(rawAccounts.map(a => [a.id, a]));
          const updated = accounts.map(a => {
            if (a.accountType) return a;
            const inferred = defaultAccountType(rawById.get(a.id)?.type);
            return inferred ? { ...a, accountType: inferred } : a;
          });
          const changed = updated.some((a, i) => a.accountType !== accounts[i]?.accountType);
          if (changed) {
            session.upsertPlaidConnection({ itemId: conn.itemId, accounts: updated });
            await savePlaidConnection({ itemId: conn.itemId, accounts: updated });
          }
        } catch (err) {
          console.error(`Account-type backfill failed for Plaid connection ${conn.itemId}:`, err);
        } finally {
          accountTypeFixingRef.current.delete(conn.itemId);
        }
      })();
    }
  }, [transactions, loadingTxns]);

  const handleRemoveSource = useCallback(async (sourceId) => {
    await deleteTransactionsBySource(sourceId);
    setTransactions(prev => prev.filter(t => t.source !== sourceId));
  }, []);

  // PlaidConnect already persists the rename + relabels stored transactions
  // server-side (renameTransactionsSource) — this just mirrors that into
  // local state so the Loaded Statements/account-filter tabs update
  // immediately instead of on next reload.
  const handleRenameSource = useCallback((sourceId, sourceName) => {
    setTransactions(prev => prev.map(t => t.source === sourceId ? { ...t, sourceName } : t));
  }, []);

  const handleRemoveTxn = useCallback(async (id) => {
    await deleteTransaction(id);
    setTransactions(prev => prev.filter(t => t.id !== id));
  }, []);

  const applyOverride = useCallback(async (txnId, fields) => {
    await setTransactionOverride(txnId, fields);
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, ...fields } : t));
  }, []);

  const handleFixPaymentLabels = useCallback(async () => {
    const fixed = await reclassifyTransactions(transactions);
    if (!fixed.length) return;
    const fixedMap = new Map(fixed.map(f => [f.id, f.fields]));
    setTransactions(prev => prev.map(t => fixedMap.has(t.id) ? { ...t, ...fixedMap.get(t.id) } : t));
  }, [transactions]);

  // Runs the same fix automatically the moment stale rows are detected,
  // rather than leaving it sitting behind the "Fix now" banner below (which
  // stays as a visible fallback/indicator, same "silent auto-fix, banner
  // only if something needs a closer look" split as the legacy-source
  // effect above) — a transaction synced before isIncome/isPayment pattern
  // coverage existed shouldn't require the user to go find a button on the
  // one tab that happens to show it, when the numbers it affects (Actual
  // spend, Income) are visible on every tab.
  useEffect(() => {
    if (loadingTxns || reclassifyingRef.current || fixableCount === 0) return;
    reclassifyingRef.current = true;
    handleFixPaymentLabels().catch(err => console.error('Auto-reclassify failed:', err)).finally(() => {
      reclassifyingRef.current = false;
    });
  }, [loadingTxns, fixableCount, handleFixPaymentLabels]);

  const handleUnlink = txn => applyOverride(txn.id, {
    overrideForcedUnmatched: true,
    overrideSplitwiseId: null, overrideExpenseData: null,
    overrideSplitwiseIds: null, overrideExpenseDataList: null,
  });
  const handleClearOverride = txn => applyOverride(txn.id, {
    overrideForcedUnmatched: null,
    overrideSplitwiseId: null, overrideExpenseData: null,
    overrideSplitwiseIds: null, overrideExpenseDataList: null,
  });

  const handleChangeCategory = async (txn, category) => {
    setTransactions(prev => prev.map(t => t.id === txn.id ? { ...t, category } : t));
    try {
      await updateTransactionCategory(txn.id, category);
    } catch {
      toast.error('Could not update category');
      setTransactions(prev => prev.map(t => t.id === txn.id ? { ...t, category: txn.category } : t));
    }
  };
  // expenses: one or more picked in SplitwisePickerModal — a single card
  // charge sometimes needs linking to more than one Splitwise expense (see
  // matcher.js's forcedLinkIds/resolveForcedLinks for how these are read
  // back). Always the FULL desired set, not an addition to what's there —
  // the modal pre-seeds its selection from the current links so editing an
  // existing multi-link "just works" via the same confirm button.
  const handlePickerConfirm = expenses => {
    applyOverride(picker.id, {
      overrideSplitwiseIds: expenses.map(e => e.id),
      overrideExpenseDataList: expenses,
      overrideSplitwiseId: null,
      overrideExpenseData: null,
      overrideForcedUnmatched: null,
    });
    setPicker(null);
  };
  // Counterpart to handlePickerSelect — a brand-new expense was just
  // created (not picked from existing ones), so overrideExpenseData is
  // built here from what we already know instead of coming from
  // fetchAllExpenses. Same override fields, same downstream matcher.js
  // handling either way.
  const handleAddNewPosted = (expense, groupId, myOwedShare) => {
    if (!addNewTarget) return;
    const overrideExpenseData = {
      id:          expense.id,
      description: expense.description || addNewTarget.description,
      date:        expense.date || addNewTarget.date,
      group_id:    groupId,
      myOwedShare,
      cost:        expense.cost != null ? parseFloat(expense.cost) : Math.abs(addNewTarget.amount || 0),
    };
    applyOverride(addNewTarget.id, { overrideSplitwiseId: expense.id, overrideForcedUnmatched: null, overrideExpenseData });
    setAddNewTarget(null);
  };
  // One-tap accept for matcher.js's suggested-match tier — same override
  // shape as picking one manually via the picker, just sourced from the
  // suggestion already computed on the transaction instead of a fresh pick.
  const handleConfirmSuggestion = txn => {
    const exp = txn.suggestedMatch?.expense;
    if (!exp) return;
    applyOverride(txn.id, { overrideSplitwiseId: exp.id, overrideForcedUnmatched: null, overrideExpenseData: exp });
  };

  // Confirming/dismissing a Tier-2 transfer hint, and confirming/dismissing
  // a Tier-1 pair — all just set overrideDismissedTransferHint/
  // overrideConfirmedTransfer on the transaction doc(s), same
  // override-field mechanism as the Splitwise match overrides above. Pairs
  // are NOT auto-confirmed (see transferMatcher.js) — amount+date alone can
  // coincidentally match two unrelated transactions on different cards, so
  // a pair needs the same explicit confirm step as a hint before it's
  // treated as a real transfer anywhere (summary totals, confident wording).
  const handleConfirmTransfer = txn => applyOverride(txn.id, { overrideConfirmedTransfer: true });
  const handleDismissTransferHint = txn => applyOverride(txn.id, { overrideDismissedTransferHint: true });
  const handleConfirmTransferPair = pair => {
    applyOverride(pair.debit.id, { overrideConfirmedTransfer: true });
    applyOverride(pair.credit.id, { overrideConfirmedTransfer: true });
  };
  const handleUnpairTransfer = pair => {
    applyOverride(pair.debit.id, { overrideDismissedTransferHint: true });
    applyOverride(pair.credit.id, { overrideDismissedTransferHint: true });
  };

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      <PageHeader title="Statements" showBack={false}>
        {statements.length > 0 && (
          <button
            onClick={() => setAccountsOpen(true)}
            title="Accounts"
            className="p-2 rounded-full text-muted hover:bg-surface-alt transition-colors shrink-0"
          >
            <Wallet size={16} />
          </button>
        )}
        {session.getPlaidConnections().length > 0 && (
          <button
            onClick={handleSyncAll}
            disabled={syncingAll}
            title="Sync all accounts"
            className="p-2 rounded-full text-muted hover:bg-surface-alt transition-colors shrink-0 disabled:opacity-60"
          >
            {syncingAll ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        )}
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-white btn-gradient btn-press shrink-0"
        >
          <Upload size={13} /> Add
        </button>
      </PageHeader>

      <MonthSlider currentMonth={currentMonth} onChange={setCurrentMonth} />

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-24 space-y-4">

          {swError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 anim-pop">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-600 font-medium">{swError}</p>
            </div>
          )}

          {/* loadTransactions() is a single flat query capped at TXN_MAX —
              hitting the cap means older transactions (from any account)
              may be silently missing rather than truncation being visible. */}
          {transactions.length >= TXN_MAX && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-amber-500 shrink-0" />
              <p className="text-xs text-amber-700 font-medium">
                Showing your most recent {TXN_MAX.toLocaleString()} transactions — older ones across all accounts may not be loaded.
              </p>
            </div>
          )}

          {/* Stat bar */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setStatBreakdown({
                title: 'Expenses this month', subtitle: monthRange.label,
                transactions: realExpenseTxns, getAmount: t => t.amount,
                total: realExpenseTxns.reduce((s, t) => s + (t.amount || 0), 0),
              })}
              className="text-left bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm card-lift"
            >
              <p className="font-bold text-ink">{realExpenseTxns.length}</p>
              <p className="text-subtle text-xs">Expenses this month</p>
            </button>
            <button
              onClick={() => setStatBreakdown({
                title: 'Total transactions amount', subtitle: monthRange.label,
                transactions: realExpenseTxns, getAmount: t => t.amount,
                total: realExpenseTxns.reduce((s, t) => s + (t.amount || 0), 0),
              })}
              className="text-left bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm card-lift"
            >
              <p className="font-bold text-ink">{formatCurrency(realExpenseTxns.reduce((s, t) => s + (t.amount || 0), 0))}</p>
              <p className="text-subtle text-xs">Total transactions amount</p>
            </button>
            <button
              onClick={() => setStatBreakdown({
                title: 'Actual spend', subtitle: monthRange.label,
                transactions: spendBreakdownTxns, getAmount: t => t.effectiveAmount, total: summary.totalEffective,
              })}
              className="text-left rounded-xl px-3 py-2.5 border border-indigo-100 card-month-total card-lift"
            >
              <p className="font-extrabold text-lg" style={{ color: INDIGO }}>{formatCurrency(summary.totalEffective)}</p>
              <p className="text-subtle text-xs">Actual spend</p>
            </button>
            <button
              onClick={() => setStatBreakdown({
                title: 'Actual Credit', subtitle: monthRange.label,
                transactions: actualCreditTxns, getAmount: t => t.amount, total: actualCreditTotal,
              })}
              className="text-left rounded-xl px-3 py-2.5 border border-emerald-100 tint-emerald-card card-lift"
            >
              <p className="font-extrabold text-lg text-emerald-600">{formatCurrency(actualCreditTotal)}</p>
              <p className="text-subtle text-xs">Actual Credit</p>
            </button>
            <button
              onClick={() => setStatBreakdown({
                title: 'Payments made', subtitle: monthRange.label,
                transactions: paymentsMade, getAmount: t => t.amount, total: paymentsMadeTotal,
              })}
              className="text-left bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm card-lift"
            >
              <p className="font-bold text-muted">{paymentsMade.length}</p>
              <p className="text-subtle text-xs">Payments made</p>
            </button>
            <button
              onClick={() => setStatBreakdown({
                title: 'Payments made', subtitle: monthRange.label,
                transactions: paymentsMade, getAmount: t => t.amount, total: paymentsMadeTotal,
              })}
              className="text-left bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm card-lift"
            >
              <p className="font-bold text-muted">{formatCurrency(paymentsMadeTotal)}</p>
              <p className="text-subtle text-xs">Payments total</p>
            </button>
            {/* Net spend + Income side by side — both are month-level
                summary figures (one derived, one a straight total), so
                pairing them into one row instead of each claiming a full
                width row reads as "these two go together" rather than two
                unrelated stat cards. */}
            <div className={`rounded-xl px-3 py-2.5 border ${netSpendTotal >= 0 ? 'border-red-100' : 'border-emerald-100'}`}>
              <p className={`font-extrabold text-lg ${netSpendTotal >= 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                {formatCurrency(Math.abs(netSpendTotal))}
              </p>
              <p className="text-subtle text-xs">Net spend</p>
            </div>
            {incomeTxns.length > 0 && (
              <button
                onClick={() => setStatBreakdown({
                  title: 'Income', subtitle: monthRange.label,
                  transactions: incomeTxns, getAmount: t => t.amount, total: incomeTotal,
                })}
                className="text-left rounded-xl px-3 py-2.5 border border-emerald-100 tint-emerald-card card-lift"
              >
                <p className="font-extrabold text-lg text-emerald-600">{formatCurrency(incomeTotal)}</p>
                <p className="text-subtle text-xs">Income · {incomeTxns.length} deposit{incomeTxns.length !== 1 ? 's' : ''}</p>
              </button>
            )}
          </div>

          {/* Card filter — deliberately styled unlike the month slider above:
              month is the page's global time scope, but which card to show
              is a separate, orthogonal filter (it combines with whatever
              month is selected, it doesn't drill into it), so it gets a
              muted/outline treatment instead of matching indigo pills.
              Grouped by bank/credit/uncategorized (see AccountsOverview.jsx
              for where that classification is actually set) instead of one
              flat row, so "which account" and "what kind of account" read
              together instead of needing the separate Accounts sheet. */}
          {statements.length > 1 && (() => {
            const chipClass = id =>
              `shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-colors btn-press whitespace-nowrap ${
                accountFilter === id ? 'bg-slate-700 text-white border-slate-700' : 'bg-surface text-muted border-edge hover:border-edge'
              }`;
            const groups = [
              { key: 'bank',   label: 'Bank',   icon: Landmark,    items: statements.filter(s => session.getAccountType(s.id) === 'bank') },
              { key: 'credit', label: 'Credit',  icon: CreditCard, items: statements.filter(s => session.getAccountType(s.id) === 'credit') },
              { key: 'other',  label: 'Other',   icon: HelpCircle, items: statements.filter(s => !session.getAccountType(s.id)) },
            ].filter(g => g.items.length > 0);
            return (
              <div className="space-y-1.5">
                {groups.map(g => (
                  <div key={g.key} className="flex flex-wrap items-center gap-1.5">
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-subtle uppercase tracking-wide pr-0.5 w-14">
                      <g.icon size={11} /> {g.label}
                    </span>
                    {g.items.length > 1 && (
                      <button onClick={() => setAccountFilter(`group:${g.key}`)} className={chipClass(`group:${g.key}`)}>
                        All {g.label === 'Credit' ? 'Cards' : g.label === 'Bank' ? 'Bank Accounts' : g.label}
                      </button>
                    )}
                    {g.items.map(s => (
                      <button key={s.id} onClick={() => setAccountFilter(s.id)} className={chipClass(s.id)}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Tabs */}
          <div className="flex bg-surface rounded-xl p-1 gap-1 border border-edge shadow-sm">
            {TABS.map((label, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                className={`flex-1 py-2 px-2 text-xs font-bold rounded-lg transition-colors relative whitespace-nowrap ${tab === i ? 'text-white' : 'text-muted hover:text-ink'}`}
                style={tab === i ? { background: INDIGO } : {}}
              >
                {label}
                {label === 'Transactions' && unmatchedCt > 0 && tab !== i && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                    {unmatchedCt > 9 ? '9+' : unmatchedCt}
                  </span>
                )}
                {label === 'Transfers' && unconfirmedTransferCt > 0 && tab !== i && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                    {unconfirmedTransferCt > 9 ? '9+' : unconfirmedTransferCt}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {loadingTxns ? (
            <div className="flex flex-col gap-3 pt-4">
              {[0, 1].map(i => <div key={i} className="h-20 rounded-2xl skeleton" />)}
            </div>
          ) : (
            <>
              {tab === 0 && <ManualEntryForm onAdd={handleAdd} />}
              {tab === 1 && (
                loadingSw ? (
                  <div className="flex flex-col gap-3 pt-4">
                    {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-2xl skeleton" />)}
                  </div>
                ) : (
                  <>
                    {fixableCount > 0 && (
                      <div className="flex items-center justify-between gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2.5 mb-3">
                        <p className="text-xs text-indigo-600 font-medium">
                          {fixableCount} transaction{fixableCount !== 1 ? 's' : ''} look{fixableCount === 1 ? 's' : ''} like a payment or income deposit but {fixableCount === 1 ? "isn't" : "aren't"} labeled that way yet.
                        </p>
                        <button onClick={handleFixPaymentLabels} className="shrink-0 text-xs font-bold text-white px-3 py-1.5 rounded-full btn-gradient btn-press">
                          Fix now
                        </button>
                      </div>
                    )}
                    <TransactionsList
                      matched={matchedBankOnly}
                      creditTxns={paymentsReceived}
                      pendingTxns={matchedPending}
                      accountSummary={accountSummary}
                      groupName={groupName}
                      monthRange={monthRange}
                      onLink={setPicker}
                      onAddNew={setAddNewTarget}
                      onUnlink={handleUnlink}
                      onClearOverride={handleClearOverride}
                      onConfirmSuggestion={handleConfirmSuggestion}
                      onDelete={handleRemoveTxn}
                      onChangeCategory={handleChangeCategory}
                      initialExpandedId={pendingOpenTxnId}
                      onDebitClick={() => setStatBreakdown({
                        title: `${accountSummary.title} — Debit`, subtitle: monthRange.label,
                        transactions: accountSummary.debitTxns, getAmount: t => t.amount, total: accountSummary.debit,
                      })}
                      onCreditClick={() => setStatBreakdown({
                        title: `${accountSummary.title} — Credit`, subtitle: monthRange.label,
                        transactions: accountSummary.creditTxns, getAmount: t => t.amount, total: accountSummary.credit,
                      })}
                    />
                  </>
                )
              )}
              {tab === 2 && (
                <StatementsReports matched={matched} splitwiseOwed={splitwiseOwed} personalTotal={personalTotal} monthRange={monthRange} />
              )}
              {tab === 3 && (
                <div className="space-y-4">
                  {/* Simple sign-based split: every credit this month is
                      money received, every debit is money paid out —
                      transfers excluded from both (see paymentsReceived/
                      paymentsMade above). */}
                  {incomeTxns.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-muted uppercase tracking-wide">
                          Income — {monthRange.label}
                        </p>
                        <p className="text-xs font-bold text-emerald-500">+{formatCurrency(incomeTotal)}</p>
                      </div>
                      <div className="space-y-2">
                        {incomeTxns.map(txn => (
                          <div key={txn.id} className="flex items-center gap-3 bg-surface rounded-xl px-3 py-2.5 border border-emerald-100 shadow-sm">
                            <span className="text-base">💵</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-ink truncate">{txn.description}</p>
                              <p className="text-xs text-subtle">{formatShortDate(txn.date)} · {txn.sourceName || txn.source}</p>
                            </div>
                            <p className="text-sm font-semibold text-emerald-500">+{formatCurrency(txn.amount)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-muted uppercase tracking-wide">
                        Payments received — {monthRange.label}
                      </p>
                      {paymentsReceived.length > 0 && (
                        <p className="text-xs font-bold text-emerald-500">+{formatCurrency(paymentsReceivedTotal)}</p>
                      )}
                    </div>
                    {paymentsReceived.length === 0 ? (
                      <div className="text-center py-6 text-sm text-subtle bg-surface rounded-2xl border border-edge">Nothing this month</div>
                    ) : (
                      <div className="space-y-2">
                        {paymentsReceived.map(txn => (
                          <div key={txn.id} className="flex items-center gap-3 bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm">
                            <span className="text-base">💰</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm text-ink truncate">{txn.transferHintLabel || txn.description}</p>
                                {txn.isIncome && (
                                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 rounded-full shrink-0">Income</span>
                                )}
                              </div>
                              <p className="text-xs text-subtle">{formatShortDate(txn.date)} · {txn.sourceName || txn.source}</p>
                            </div>
                            <p className="text-sm font-semibold text-emerald-500">+{formatCurrency(txn.amount)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-muted uppercase tracking-wide">
                        Payments made — {monthRange.label}
                      </p>
                      {paymentsMade.length > 0 && (
                        <p className="text-xs font-bold text-muted">{formatCurrency(paymentsMadeTotal)}</p>
                      )}
                    </div>
                    {paymentsMade.length === 0 ? (
                      <div className="text-center py-6 text-sm text-subtle bg-surface rounded-2xl border border-edge">Nothing this month</div>
                    ) : (
                      <div className="space-y-2">
                        {paymentsMade.map(txn => (
                          <div key={txn.id} className="flex items-center gap-3 bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm">
                            <span className="text-base">💳</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-ink truncate">{txn.transferHintLabel || txn.description}</p>
                              <p className="text-xs text-subtle">{formatShortDate(txn.date)} · {txn.sourceName || txn.source}</p>
                            </div>
                            <p className="text-sm font-semibold text-muted">{formatCurrency(txn.amount)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-subtle mt-1.5">Not counted in expense totals.</p>
                  </div>

                  {swPayments.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Splitwise payments received</p>
                      <div className="space-y-2">
                        {swPayments.map(p => (
                          <div key={p.id} className="flex items-center gap-3 bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm">
                            <span className="text-base">🤝</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-ink truncate">{p.description}</p>
                              <p className="text-xs text-subtle">{formatShortDate(p.date)} · from {p.paidBy}</p>
                            </div>
                            <p className="text-sm font-semibold text-emerald-500">+{formatCurrency(p.amount)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tab === 4 && (
                <TransfersList
                  pairs={transferPairsThisMonth}
                  hints={transferHintsThisMonth}
                  monthRange={monthRange}
                  onConfirm={handleConfirmTransfer}
                  onDismiss={handleDismissTransferHint}
                  onConfirmPair={handleConfirmTransferPair}
                  onUnpair={handleUnpairTransfer}
                />
              )}
            </>
          )}
        </div>
      </main>

      {picker && (
        <SplitwisePickerModal
          transaction={picker}
          myId={myId}
          groups={groups}
          initialExpenses={swExpenses}
          selectedIds={picker.overrideSplitwiseIds || (picker.overrideSplitwiseId ? [picker.overrideSplitwiseId] : [])}
          onConfirm={handlePickerConfirm}
          onClose={() => setPicker(null)}
        />
      )}

      {addNewTarget && (
        <AddToSplitwiseModal
          transaction={addNewTarget}
          myId={myId}
          groups={groups}
          onPosted={handleAddNewPosted}
          onClose={() => setAddNewTarget(null)}
        />
      )}

      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in"
          onClick={e => e.target === e.currentTarget && setUploadOpen(false)}
        >
          <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-surface-alt" />
            </div>
            <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
              <p className="font-extrabold text-ink text-sm">Add transactions</p>
              <button onClick={() => setUploadOpen(false)} className="p-1.5 rounded-lg text-subtle hover:text-muted">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-4 space-y-4">
              <PlaidConnect onAdd={handleAdd} onRenameSource={handleRenameSource} />
              <StatementUpload
                statements={statements}
                onAdd={handleAdd}
                onRemoveSource={handleRemoveSource}
                onUploaded={() => { setUploadOpen(false); setTab(1); }}
              />
            </div>
          </div>
        </div>
      )}

      {accountsOpen && (
        <AccountsOverview
          statements={statements}
          monthlyTransactions={monthlyTransactionsAllAccounts}
          monthRange={monthRange}
          onSelectAccount={sourceId => { setAccountFilter(sourceId); setTab(1); setAccountsOpen(false); }}
          onClose={() => setAccountsOpen(false)}
        />
      )}

      {statBreakdown && (
        <StatBreakdown
          {...statBreakdown}
          onClose={() => setStatBreakdown(null)}
        />
      )}

      <BottomNav />
    </div>
  );
}
