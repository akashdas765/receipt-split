import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, AlertCircle, Trash2 } from 'lucide-react';
import { loadTransactions, addTransactions, deleteTransaction, deleteTransactionsBySource, setTransactionOverride } from '../services/db';
import { fetchGroups, fetchCurrentUser, fetchAllExpenses } from '../services/splitwise';
import { matchTransactions, computeSummary } from '../utils/matcher';
import { getMonthRange, prevMonth, nextMonth, formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';
import StatementUpload from '../components/StatementUpload';
import ManualEntryForm from '../components/ManualEntryForm';
import MatchReview from '../components/MatchReview';
import StatementsReports from '../components/StatementsReports';
import SplitwisePickerModal from '../components/SplitwisePickerModal';

const INDIGO = '#6366f1';

const TABS = ['Upload', 'Manual', 'Review', 'Reports', 'All', 'Payments'];

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

  const [tab,    setTab]    = useState(0);
  const [picker, setPicker] = useState(null); // txn being linked, or null

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
  const monthlyTransactions = useMemo(() =>
    transactions.filter(t => t.date && t.date.slice(0, 10) >= monthRange.start && t.date.slice(0, 10) <= monthRange.end),
    [transactions, monthRange]
  );
  const bankExpenseTxns   = useMemo(() => monthlyTransactions.filter(t => !t.isPayment), [monthlyTransactions]);
  const monthlyPaymentTxns = useMemo(() => monthlyTransactions.filter(t => t.isPayment), [monthlyTransactions]);

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

  // ── Mutations ──────────────────────────────────────────────────────────────
  const handleAdd = useCallback(async (newTxns, sourceName) => {
    await addTransactions(newTxns, sourceName);
    const uploadedAt = new Date().toISOString();
    setTransactions(prev => [...prev, ...newTxns.map(t => ({ ...t, sourceName, uploadedAt }))]);
  }, []);

  const handleRemoveSource = useCallback(async (sourceId) => {
    await deleteTransactionsBySource(sourceId);
    setTransactions(prev => prev.filter(t => t.source !== sourceId));
  }, []);

  const handleRemoveTxn = useCallback(async (id) => {
    await deleteTransaction(id);
    setTransactions(prev => prev.filter(t => t.id !== id));
  }, []);

  const applyOverride = useCallback(async (txnId, fields) => {
    await setTransactionOverride(txnId, fields);
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, ...fields } : t));
  }, []);

  const handleUnlink = txn => applyOverride(txn.id, { overrideForcedUnmatched: true, overrideSplitwiseId: null, overrideExpenseData: null });
  const handleClearOverride = txn => applyOverride(txn.id, { overrideForcedUnmatched: null, overrideSplitwiseId: null, overrideExpenseData: null });
  const handlePickerSelect = exp => {
    applyOverride(picker.id, { overrideSplitwiseId: exp.id, overrideForcedUnmatched: null, overrideExpenseData: exp });
    setPicker(null);
  };

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      {/* Header */}
      <header className="sticky top-0 z-20 glass">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-600 btn-press">
            <ArrowLeft size={20} />
          </button>
          <span className="font-extrabold text-slate-800 flex-1">Statements</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentMonth(prevMonth)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 btn-press">
              <ChevronLeft size={18} />
            </button>
            <span className="text-xs font-bold text-slate-600 w-24 text-center">{monthRange.label}</span>
            <button onClick={() => setCurrentMonth(nextMonth)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 btn-press">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-10 space-y-4">

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

          {/* Tabs */}
          <div className="flex bg-white rounded-xl p-1 gap-1 border border-slate-100 shadow-sm overflow-x-auto">
            {TABS.map((label, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                className={`flex-1 py-2 px-2 text-xs font-bold rounded-lg transition-colors relative whitespace-nowrap ${tab === i ? 'text-white' : 'text-slate-500 hover:text-slate-700'}`}
                style={tab === i ? { background: INDIGO } : {}}
              >
                {label}
                {label === 'Review' && unmatchedCt > 0 && tab !== i && (
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
              {tab === 0 && (
                <StatementUpload statements={statements} onAdd={handleAdd} onRemoveSource={handleRemoveSource} onUploaded={() => setTab(2)} />
              )}
              {tab === 1 && <ManualEntryForm onAdd={handleAdd} />}
              {tab === 2 && (
                loadingSw ? (
                  <div className="flex flex-col gap-3 pt-4">
                    {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-2xl skeleton" />)}
                  </div>
                ) : (
                  <MatchReview
                    matched={matchedBankOnly}
                    groupName={groupName}
                    monthRange={monthRange}
                    onLink={setPicker}
                    onUnlink={handleUnlink}
                    onClearOverride={handleClearOverride}
                  />
                )
              )}
              {tab === 3 && (
                <StatementsReports matched={matched} splitwiseOwed={splitwiseOwed} personalTotal={personalTotal} monthRange={monthRange} />
              )}
              {tab === 4 && (
                <div className="space-y-2">
                  {transactions.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-400">No transactions loaded yet</div>
                  ) : (
                    transactions.slice().reverse().map(txn => (
                      <div key={txn.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-slate-100 shadow-sm">
                        <span className="text-base">{getCategoryIcon(txn.category)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-700 truncate">{txn.description}</p>
                          <p className="text-xs text-slate-400">{formatShortDate(txn.date)} · {txn.sourceName || txn.source}</p>
                        </div>
                        <p className="text-sm font-bold text-slate-800">{formatCurrency(txn.amount)}</p>
                        <button onClick={() => handleRemoveTxn(txn.id)} className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
              {tab === 5 && (
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
    </div>
  );
}
