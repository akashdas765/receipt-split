import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CreditCard, Upload, X } from 'lucide-react';
import { loadTransactions, addTransactions, deleteTransaction, deleteTransactionsBySource, setTransactionOverride, reclassifyPayments } from '../services/db';
import { fetchGroups, fetchCurrentUser, fetchAllExpenses } from '../services/splitwise';
import { matchTransactions, computeSummary } from '../utils/matcher';
import { getMonthRange, formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { isPaymentTransaction } from '../utils/paymentDetector';
import { session } from '../services/session';
import StatementUpload from '../components/StatementUpload';
import PlaidConnect from '../components/PlaidConnect';
import ManualEntryForm from '../components/ManualEntryForm';
import TransactionsList from '../components/TransactionsList';
import StatementsReports from '../components/StatementsReports';
import SplitwisePickerModal from '../components/SplitwisePickerModal';
import BottomNav from '../components/BottomNav';
import MonthSlider from '../components/MonthSlider';
import PageHeader from '../components/PageHeader';

const INDIGO = '#6366f1';

// 'Upload' isn't a tab — connecting a bank / dropping a statement isn't
// something you switch to and browse, it's a one-off action, so it lives
// behind its own "Add" button (opens a bottom sheet) instead of competing
// for space with the tabs you actually flip between day to day.
//
// 'Transactions' replaces the old separate 'Review' + 'All' tabs — one
// list of every card transaction (credit or debit) for the month, with
// the Splitwise match-review workflow available as a filter within it
// instead of a whole separate tab.
const TABS = ['Manual', 'Transactions', 'Reports', 'Payments'];

export default function StatementsPage() {
  const navigate = useNavigate();

  const [transactions, setTransactions] = useState([]);
  const [loadingTxns,  setLoadingTxns]  = useState(true);

  const [groups, setGroups] = useState([]);
  const [myId,   setMyId]   = useState(null);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [swExpenses,   setSwExpenses]   = useState([]);
  const [swPayments,   setSwPayments]   = useState([]);
  const [loadingSw,    setLoadingSw]    = useState(true);
  const [swError,      setSwError]      = useState('');

  const [tab,    setTab]    = useState(1); // 'Transactions' — Upload moved out of the tab bar, so it's no longer the default landing tab
  const [picker, setPicker] = useState(null); // txn being linked, or null
  const [uploadOpen, setUploadOpen] = useState(false);

  // Which loaded statement/account to scope the page to — 'all' or a
  // `source` id. Each connected card (Plaid) or uploaded file gets its own
  // source, so with 3 connected cards this doubles as "3 tabs for 3
  // accounts" without a separate account model to keep in sync.
  const [accountFilter, setAccountFilter] = useState('all');

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
    fetchCurrentUser().then(u => setMyId(u.id)).catch(() => {});
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
  // Scoped to the selected statement/account (or everything, when 'all') —
  // computed off the full list so switching the filter never has to re-fetch.
  const scopedTransactions = useMemo(() =>
    accountFilter === 'all' ? transactions : transactions.filter(t => t.source === accountFilter),
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
  const bankExpenseTxns   = useMemo(() =>
    monthlyTransactions.filter(t => !t.isPayment && !t.isPending).map(t => ({ ...t, isBankAccount: session.isBankAccountSource(t.source) })),
    [monthlyTransactions]
  );
  const monthlyPaymentTxns = useMemo(() => monthlyTransactions.filter(t => t.isPayment), [monthlyTransactions]);
  const pendingTxns = useMemo(() => monthlyTransactions.filter(t => t.isPending && !t.isPayment), [monthlyTransactions]);

  const matched = useMemo(() => matchTransactions(bankExpenseTxns, swExpenses), [bankExpenseTxns, swExpenses]);
  const matchedBankOnly = useMemo(() => matched.filter(t => !t.isSplitOnly), [matched]);
  const summary = useMemo(() => computeSummary(matched), [matched]);

  const splitwiseOwed = useMemo(() => swExpenses.reduce((s, e) => s + (e.myOwedShare || 0), 0), [swExpenses]);
  const personalTotal = useMemo(() =>
    matched.filter(t => !t.isSplitwised && !t.isSplitOnly).reduce((s, t) => s + (t.effectiveAmount || 0), 0),
    [matched]
  );

  // Loaded statements, derived from ALL transactions (not just this month) —
  // grouped by `source`, labeled with the sourceName stamped on upload.
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

  const paymentTotal = monthlyPaymentTxns.reduce((s, t) => s + (t.amount || 0), 0);
  const unmatchedCt  = matchedBankOnly.filter(t => !t.isSplitwised).length;

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
  // One-tap accept for matcher.js's suggested-match tier — same override
  // shape as picking one manually via the picker, just sourced from the
  // suggestion already computed on the transaction instead of a fresh pick.
  const handleConfirmSuggestion = txn => {
    const exp = txn.suggestedMatch?.expense;
    if (!exp) return;
    applyOverride(txn.id, { overrideSplitwiseId: exp.id, overrideForcedUnmatched: null, overrideExpenseData: exp });
  };

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      <PageHeader title="Statements" onBack={() => navigate('/')}>
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

          {/* Stat bar */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
              <p className="font-bold text-slate-800">{bankExpenseTxns.length}</p>
              <p className="text-slate-400 text-xs">Expenses this month</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
              <p className="font-bold text-slate-800">{formatCurrency(bankExpenseTxns.reduce((s, t) => s + (t.amount || 0), 0))}</p>
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
              <p className="font-bold text-slate-600">{monthlyPaymentTxns.length}</p>
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
              muted/outline treatment instead of matching indigo pills. */}
          {statements.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wide pr-0.5">
                <CreditCard size={11} /> Card
              </span>
              <button
                onClick={() => setAccountFilter('all')}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-colors btn-press ${accountFilter === 'all' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
              >
                All
              </button>
              {statements.map(s => (
                <button
                  key={s.id}
                  onClick={() => setAccountFilter(s.id)}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-colors btn-press whitespace-nowrap ${accountFilter === s.id ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

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
                      groupName={groupName}
                      monthRange={monthRange}
                      onLink={setPicker}
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
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Card payments & transfers — {monthRange.label}</p>
                    {monthlyPaymentTxns.length === 0 ? (
                      <div className="text-center py-6 text-sm text-slate-400 bg-white rounded-2xl border border-slate-100">Nothing this month</div>
                    ) : (
                      <div className="space-y-2">
                        {monthlyPaymentTxns.map(txn => (
                          <div key={txn.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
                            <span className="text-base">💳</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-slate-700 truncate">{txn.description}</p>
                              <p className="text-xs text-slate-400">{formatShortDate(txn.date)} · {txn.sourceName || txn.source}</p>
                            </div>
                            <p className="text-sm font-semibold text-slate-600">{formatCurrency(txn.amount)}</p>
                          </div>
                        ))}
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

      <BottomNav />
    </div>
  );
}
