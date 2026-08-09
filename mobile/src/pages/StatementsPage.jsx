import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CreditCard, Landmark, HelpCircle, Wallet, Upload, X } from 'lucide-react';
import { loadTransactions, addTransactions, deleteTransaction, deleteTransactionsBySource, setTransactionOverride, reclassifyPayments, savePlaidConnection, TXN_MAX } from '../services/db';
import { fetchGroups, fetchCurrentUser, fetchAllExpenses } from '../services/splitwise';
import { syncPlaidConnection } from '../services/plaidSync';
import { matchTransactions, computeSummary } from '../utils/matcher';
import { detectTransfers } from '../utils/transferMatcher';
import { getMonthRange, formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { isPaymentTransaction, isCreditConfirmation } from '../utils/paymentDetector';
import { session } from '../services/session';
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
  const navigate = useNavigate();

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

  const groupName = id => groups.find(g => g.id === id)?.name;
  const monthRange = useMemo(() => getMonthRange(currentMonth), [currentMonth]);

  // ── Initial load: transactions + groups + current Splitwise user ─────────
  useEffect(() => {
    (async () => {
      setLoadingTxns(true);
      const [txns] = await Promise.all([loadTransactions()]);
      setTransactions(txns);
      setLoadingTxns(false);
    })();

    fetchGroups().then(setGroups).catch(() => {});
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
  // monthlyPaymentTxns below); matcher.js separately skips scoring
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

  const bankExpenseTxns   = useMemo(() =>
    monthlyTransactions
      .filter(t => !t.isPayment && !t.isPending)
      .map(t => ({
        ...t,
        isBankAccount: session.isBankAccountSource(t.source),
        isTransfer: transferLabelById.has(t.id),
        transferHintLabel: transferLabelById.get(t.id),
      })),
    [monthlyTransactions, transferLabelById]
  );
  // A card "Payment Thank You"-style credit is your OWN money paying down
  // your own balance — not new credit, same idea as a transfer not being
  // real income. isCreditConfirmation's pattern match is reliable enough to
  // surface as a suggestion, but (same lesson as the transfer false-
  // positive) never confident enough to silently change a total on its own
  // — so it's a candidate needing one tap to confirm, same shape as
  // transfers. Bank accounts don't get this treatment — scoped via
  // "not bank" rather than "=== 'credit'" since plenty of real card
  // accounts never get an explicit accountType (unclassified/'other'
  // sources are still cards, same convention accountSummary uses below
  // for its bank-vs-card split).
  const monthlyPaymentTxns = useMemo(() =>
    monthlyTransactions
      .filter(t => t.isPayment)
      .map(t => {
        const isPaymentCandidate = t.isCredit && isCreditConfirmation(t.description) && session.getAccountType(t.source) !== 'bank';
        return {
          ...t,
          isTransfer: transferLabelById.has(t.id),
          transferHintLabel: transferLabelById.get(t.id),
          isPaymentCandidate,
          paymentConfirmed: isPaymentCandidate && !!t.overrideConfirmedPayment,
          paymentNeedsConfirm: isPaymentCandidate && !t.overrideConfirmedPayment && !t.overrideDismissedPaymentHint,
        };
      }),
    [monthlyTransactions, transferLabelById]
  );
  const unconfirmedPaymentCt = useMemo(() => monthlyPaymentTxns.filter(t => t.paymentNeedsConfirm).length, [monthlyPaymentTxns]);
  const pendingTxns = useMemo(() => monthlyTransactions.filter(t => t.isPending && !t.isPayment), [monthlyTransactions]);

  // Spend/expense TOTALS still exclude transfers (a transfer was never
  // spend, however visible it stays in the actual transaction list) — used
  // by the stat bar below instead of bankExpenseTxns directly.
  const realExpenseTxns = useMemo(() => bankExpenseTxns.filter(t => !t.isTransfer), [bankExpenseTxns]);

  // Account-aware Debit/Credit/Net summary — deliberately computed from the
  // RAW month(+account)-scoped transaction list, not bankExpenseTxns/
  // monthlyPaymentTxns (which exclude confirmed transfers for Splitwise-
  // matching purposes). A real bank statement counts a transfer-out as a
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
      const debit  = settled.filter(t => !t.isCredit && !t.overrideConfirmedTransfer).reduce((s, t) => s + (t.amount || 0), 0);
      // Confirmed "payment thank you"-style credits are excluded here — your
      // own money paying down your own card isn't real credit, same reason
      // a confirmed transfer isn't real income (see transferAmt below).
      // Unconfirmed candidates stay counted until the user actually
      // confirms one, same "don't change a total before confirmation"
      // policy used for transfers.
      const credit = settled.filter(t => t.isCredit && !t.overrideConfirmedPayment && !t.overrideConfirmedTransfer).reduce((s, t) => s + (t.amount || 0), 0);
      const inScope = scopePredicate;
      const transferPairAmt = transferPairsThisMonth
        .filter(p => p.confirmed && (inScope(p.debit.source) || inScope(p.credit.source)))
        .reduce((s, p) => s + p.debit.amount, 0);
      const transferHintAmt = transferHintsThisMonth
        .filter(h => h.confirmed && inScope(h.txn.source))
        .reduce((s, h) => s + h.txn.amount, 0);
      // "Payments made" (cards only) — the narrow isCreditConfirmation
      // pattern ("payment thank you", "autopay", ...) specifically means a
      // bill payment reduced the balance, as opposed to a merchant refund
      // (also a credit, but not a payment) — isPayment alone can't tell
      // these apart since every credit is already tagged isPayment.
      const payments = settled
        .filter(t => t.isCredit && isCreditConfirmation(t.description))
        .reduce((s, t) => s + (t.amount || 0), 0);
      return { debit, credit, net: credit - debit, transfers: transferPairAmt + transferHintAmt, payments };
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
  // computeSummary excludes them explicitly since "My actual spend" must
  // not count a transfer as spend even though the row itself stays visible.
  const matched = useMemo(() => matchTransactions(bankExpenseTxns, swExpenses), [bankExpenseTxns, swExpenses]);
  const matchedBankOnly = useMemo(() => matched.filter(t => !t.isSplitOnly), [matched]);
  const summary = useMemo(() => computeSummary(matched.filter(t => !t.isTransfer)), [matched]);

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

  // For a card, "Payments" should mean actual bill payments only — a
  // merchant refund lands in the same isPayment bucket (it's a credit, not
  // spend) but isn't a payment, so it stays out of this dedicated list
  // (it's still visible in the Transactions tab's credit view). Bank
  // accounts keep every isPayment credit — "money received" is a broader,
  // legitimately mixed bucket there (interest, Zelle receipts, refunds).
  const paymentsToShow = accountSummary.type === 'card'
    ? monthlyPaymentTxns.filter(t => t.isPaymentCandidate)
    : monthlyPaymentTxns;

  const paymentTotal = paymentsToShow.reduce((s, t) => s + (t.amount || 0), 0);
  // Excludes transfers — the "needs your attention" badge shouldn't count
  // rows that were never Splitwise-matchable to begin with (same reasoning
  // as excluding them from realExpenseTxns above).
  const unmatchedCt  = matchedBankOnly.filter(t => !t.isSplitwised && !t.isTransfer).length;

  // Transactions saved before their description was checked against the
  // payment patterns (isPayment is stamped once at write time, not
  // recomputed live) — surfaced so the user can fix them without a full
  // re-sync/re-upload. Checked across ALL loaded transactions, not just
  // this month, since a stale row could be from any past statement.
  const fixableCount = useMemo(() =>
    transactions.filter(t => !t.isPayment && isPaymentTransaction(t.description)).length,
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
    await addTransactions(newTxns, sourceName);
    const uploadedAt = new Date().toISOString();
    setTransactions(prev => {
      const byId = new Map(prev.map(t => [t.id, t]));
      for (const t of newTxns) {
        byId.set(t.id, { ...byId.get(t.id), ...t, sourceName, uploadedAt });
      }
      return Array.from(byId.values());
    });
  }, []);

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
    const fixed = await reclassifyPayments(transactions);
    if (!fixed.length) return;
    const fixedMap = new Map(fixed.map(f => [f.id, f.fields]));
    setTransactions(prev => prev.map(t => fixedMap.has(t.id) ? { ...t, ...fixedMap.get(t.id) } : t));
  }, [transactions]);

  const handleUnlink = txn => applyOverride(txn.id, { overrideForcedUnmatched: true, overrideSplitwiseId: null, overrideExpenseData: null });
  const handleClearOverride = txn => applyOverride(txn.id, { overrideForcedUnmatched: null, overrideSplitwiseId: null, overrideExpenseData: null });
  const handlePickerSelect = exp => {
    applyOverride(picker.id, { overrideSplitwiseId: exp.id, overrideForcedUnmatched: null, overrideExpenseData: exp });
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

  // Confirming/dismissing a card "payment thank you"-style credit — see
  // monthlyPaymentTxns above for why this needs the same confirm step as a
  // transfer before accountSummary pulls it out of the card's credit total.
  const handleConfirmPayment = txn => applyOverride(txn.id, { overrideConfirmedPayment: true });
  const handleDismissPaymentHint = txn => applyOverride(txn.id, { overrideDismissedPaymentHint: true });

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      <PageHeader title="Statements" onBack={() => navigate('/')}>
        {statements.length > 0 && (
          <button
            onClick={() => setAccountsOpen(true)}
            title="Accounts"
            className="p-2 rounded-full text-slate-500 hover:bg-slate-100 transition-colors shrink-0"
          >
            <Wallet size={16} />
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
            <div className="bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
              <p className="font-bold text-slate-800">{realExpenseTxns.length}</p>
              <p className="text-slate-400 text-xs">Expenses this month</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
              <p className="font-bold text-slate-800">{formatCurrency(realExpenseTxns.reduce((s, t) => s + (t.amount || 0), 0))}</p>
              <p className="text-slate-400 text-xs">Gross total</p>
            </div>
            <div className="col-span-2 rounded-xl px-3 py-2.5 border border-indigo-100" style={{ background: '#eef1fb' }}>
              <div className="flex items-baseline justify-between">
                <p className="font-extrabold text-lg" style={{ color: INDIGO }}>{formatCurrency(summary.totalEffective)}</p>
                {summary.totalSavings > 0.5 && (
                  <p className="text-emerald-500 text-xs font-semibold">-{formatCurrency(summary.totalSavings)} saved via splits</p>
                )}
              </div>
              <p className="text-slate-400 text-xs">My actual spend</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
              <p className="font-bold text-slate-600">{paymentsToShow.length}</p>
              <p className="text-slate-400 text-xs">Payments made</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
              <p className="font-bold text-slate-600">{formatCurrency(paymentTotal)}</p>
              <p className="text-slate-400 text-xs">Payments total</p>
            </div>
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
                accountFilter === id ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
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
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide pr-0.5 w-14">
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
          <div className="flex bg-white rounded-xl p-1 gap-1 border border-slate-100 shadow-sm">
            {TABS.map((label, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                className={`flex-1 py-2 px-2 text-xs font-bold rounded-lg transition-colors relative whitespace-nowrap ${tab === i ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}
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
                {label === 'Payments' && unconfirmedPaymentCt > 0 && tab !== i && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                    {unconfirmedPaymentCt > 9 ? '9+' : unconfirmedPaymentCt}
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
                          {fixableCount} transaction{fixableCount !== 1 ? 's' : ''} look{fixableCount === 1 ? 's' : ''} like a payment but {fixableCount === 1 ? "isn't" : "aren't"} labeled that way yet.
                        </p>
                        <button onClick={handleFixPaymentLabels} className="shrink-0 text-xs font-bold text-white px-3 py-1.5 rounded-full btn-gradient btn-press">
                          Fix now
                        </button>
                      </div>
                    )}
                    <TransactionsList
                      matched={matchedBankOnly}
                      creditTxns={monthlyPaymentTxns}
                      pendingTxns={pendingTxns}
                      accountSummary={accountSummary}
                      groupName={groupName}
                      monthRange={monthRange}
                      onLink={setPicker}
                      onAddNew={setAddNewTarget}
                      onUnlink={handleUnlink}
                      onClearOverride={handleClearOverride}
                      onConfirmSuggestion={handleConfirmSuggestion}
                      onDelete={handleRemoveTxn}
                    />
                  </>
                )
              )}
              {tab === 2 && (
                <StatementsReports matched={matched} splitwiseOwed={splitwiseOwed} personalTotal={personalTotal} monthRange={monthRange} />
              )}
              {tab === 3 && (
                <div className="space-y-4">
                  <div>
                    {/* "Card payment" only makes sense for a credit card
                        (paying down what you owe) -- the same isPayment
                        bucket also holds bank-account credits like interest
                        paid or a Zelle/person-to-person receipt, which read
                        as money coming IN, not a payment going out. Labeled
                        per-account-type like accountSummary below — bank and
                        credit are never mixed in one view, so every row in
                        this list shares accountSummary.type. */}
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                      {accountSummary.type === 'bank' ? 'Money received' : 'Card payments'} — {monthRange.label}
                    </p>
                    {paymentsToShow.length === 0 ? (
                      <div className="text-center py-6 text-sm text-slate-400 bg-white rounded-2xl border border-slate-100">Nothing this month</div>
                    ) : (
                      <div className="space-y-2">
                        {paymentsToShow.map(txn => {
                          const isBankTxn = accountSummary.type === 'bank';
                          if (txn.paymentNeedsConfirm) {
                            return (
                              <div key={txn.id} className="rounded-xl border border-amber-100 bg-white p-3">
                                <div className="flex items-center gap-3">
                                  <span className="text-base shrink-0">💳</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-700 truncate">{txn.description}</p>
                                    <p className="text-xs text-amber-500 mt-0.5">Possible bill payment · {formatShortDate(txn.date)} · {txn.sourceName || txn.source}</p>
                                  </div>
                                  <p className="text-sm font-semibold text-slate-600 shrink-0">{formatCurrency(txn.amount)}</p>
                                </div>
                                <div className="flex gap-2 pt-2 mt-2 border-t border-slate-100">
                                  <button
                                    onClick={() => handleDismissPaymentHint(txn)}
                                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl py-2 hover:bg-slate-50 transition-colors"
                                  >
                                    Not a payment
                                  </button>
                                  <button
                                    onClick={() => handleConfirmPayment(txn)}
                                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-white rounded-xl py-2 transition-colors"
                                    style={{ background: INDIGO }}
                                  >
                                    Confirm payment
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={txn.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
                              <span className="text-base">{isBankTxn ? '💰' : '💳'}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-700 truncate">{txn.description}</p>
                                <p className="text-xs text-slate-400">
                                  {formatShortDate(txn.date)} · {txn.sourceName || txn.source}
                                  {txn.paymentConfirmed && <span className="ml-1.5 font-semibold" style={{ color: INDIGO }}>· confirmed, excluded from credit</span>}
                                </p>
                              </div>
                              <p className={`text-sm font-semibold ${isBankTxn ? 'text-emerald-500' : 'text-slate-600'}`}>
                                {isBankTxn ? '+' : ''}{formatCurrency(txn.amount)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-xs text-slate-400 mt-1.5">Not counted in expense totals.</p>
                  </div>

                  {swPayments.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Splitwise payments received</p>
                      <div className="space-y-2">
                        {swPayments.map(p => (
                          <div key={p.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
                            <span className="text-base">🤝</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-700 truncate">{p.description}</p>
                              <p className="text-xs text-slate-400">{formatShortDate(p.date)} · from {p.paidBy}</p>
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
          onSelect={handlePickerSelect}
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
          <div className="bg-white rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-200" />
            </div>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="font-extrabold text-slate-800 text-sm">Add transactions</p>
              <button onClick={() => setUploadOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600">
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

      <BottomNav />
    </div>
  );
}
