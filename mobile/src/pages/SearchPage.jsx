import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, X, Receipt, CheckCheck, Users, AlertCircle } from 'lucide-react';
import { loadReceiptsForInsights, loadTransactions } from '../services/db';
import { fetchCurrentUser, fetchAllExpenses } from '../services/splitwise';
import { getCategoryIcon } from '../utils/categoryDetector';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';
import BottomNav from '../components/BottomNav';
import PageHeader from '../components/PageHeader';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';
const TEAL    = '#14b8a6';

function formatWithCurrency(amount, currencyCode) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

// Searches across everything this app knows about — receipts, full
// Splitwise history, and imported bank transactions — same three sources
// HomePage/Insights/Statements each show separately.
export default function SearchPage() {
  const navigate = useNavigate();
  const [query,   setQuery]   = useState('');
  const [loading, setLoading] = useState(true);

  const [receipts,   setReceipts]   = useState([]);
  const [bankTxns,   setBankTxns]   = useState([]);
  const [swExpenses, setSwExpenses] = useState([]); // USD
  const [swForeign,  setSwForeign]  = useState([]); // non-USD — see fetchAllExpenses
  const [myId,       setMyId]       = useState(null);

  // Surfaced instead of silently swallowed (same class of bug fixed on
  // HomePage) — without this, a failed Splitwise fetch just meant "Splitwise
  // results never show up" with zero indication why.
  const [swError, setSwError] = useState('');

  useEffect(() => {
    (async () => {
      const [receiptsList, txns, me] = await Promise.all([
        loadReceiptsForInsights(),
        loadTransactions(),
        fetchCurrentUser().catch(err => { setSwError(err?.message || 'Could not connect to Splitwise.'); return null; }),
      ]);
      setReceipts(receiptsList);
      setBankTxns(txns);

      if (me?.id) {
        setMyId(me.id);
        // No date bound — search should cover full history, not just a
        // recent window (fetchAllExpenses still caps at 500 most-recent
        // expenses server-side).
        try {
          const { expenses, otherCurrencyExpenses } = await fetchAllExpenses(me.id, {});
          setSwExpenses(expenses);
          setSwForeign(otherCurrencyExpenses);
        } catch (err) {
          setSwError(err?.message || 'Could not load Splitwise expenses.');
        }
      }
      setLoading(false);
    })();
  }, []);

  // A receipt posted through this app IS a Splitwise expense — exclude
  // those from the Splitwise results so they don't show up twice.
  const postedExpenseIds = useMemo(() =>
    new Set(receipts.filter(r => r.approved && r.splitwise_expense_id).map(r => r.splitwise_expense_id)),
    [receipts]
  );

  const q = query.trim().toLowerCase();

  const matchedReceipts = useMemo(() =>
    q ? receipts.filter(r => (r.merchant || '').toLowerCase().includes(q)) : [],
    [receipts, q]
  );
  const matchedSwUsd = useMemo(() =>
    q ? swExpenses.filter(e => !postedExpenseIds.has(e.id) && (e.description || '').toLowerCase().includes(q)) : [],
    [swExpenses, postedExpenseIds, q]
  );
  const matchedSwForeign = useMemo(() =>
    q ? swForeign.filter(e => !postedExpenseIds.has(e.id) && (e.description || '').toLowerCase().includes(q)) : [],
    [swForeign, postedExpenseIds, q]
  );
  const matchedBank = useMemo(() =>
    q ? bankTxns.filter(t => (t.description || '').toLowerCase().includes(q)) : [],
    [bankTxns, q]
  );

  const resultCount = matchedReceipts.length + matchedSwUsd.length + matchedSwForeign.length + matchedBank.length;

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      <PageHeader title="Search" showBack={false} />

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-24 space-y-4">
          {swError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 anim-pop">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-600 font-medium">{swError} Splitwise results won't show until this is fixed.</p>
            </div>
          )}

          <div className="relative">
            <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search receipts, Splitwise, bank transactions…"
              className="w-full bg-white border border-slate-200 rounded-2xl pl-10 pr-9 py-3 text-sm text-slate-800 outline-none focus:border-indigo-300 shadow-sm"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col gap-3 pt-4">
              {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-2xl skeleton" />)}
            </div>
          ) : !q ? (
            <div className="flex flex-col items-center justify-center py-20 text-center anim-scale-in">
              <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center mb-4 anim-float">
                <SearchIcon size={32} style={{ color: '#a5b4fc' }} />
              </div>
              <h2 className="text-lg font-bold text-slate-500 mb-1">Search everything</h2>
              <p className="text-sm text-slate-400">Receipts, Splitwise expenses, and bank transactions</p>
            </div>
          ) : resultCount === 0 ? (
            <div className="text-center py-16 text-sm text-slate-400">No matches for "{query}"</div>
          ) : (
            <div className="flex flex-col gap-3 stagger">
              <p className="text-xs text-slate-400 font-medium">{resultCount} result{resultCount !== 1 ? 's' : ''}</p>

              {matchedReceipts.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate('/detail', { state: r })}
                  className="w-full text-left bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:border-indigo-100 card-lift anim-fade-up"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md"
                      style={{ background: r.approved
                        ? 'linear-gradient(135deg, #10b981, #14b8a6)'
                        : 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                      {r.approved ? <CheckCheck size={18} color="#fff" /> : <Receipt size={18} color="#fff" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 text-sm truncate">{r.merchant || 'Unknown merchant'}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-400">{r.date || r.scanned_at?.slice(0, 10)}</span>
                        <span className="text-slate-200">·</span>
                        <span className="text-xs font-semibold" style={{ color: r.approved ? EMERALD : '#f59e0b' }}>
                          {r.approved ? 'Posted' : 'Pending'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {r.approved && myId && r.personTotals?.[myId] != null ? (
                        <>
                          <p className="font-bold text-slate-800 text-sm">${r.personTotals[myId].toFixed(2)}</p>
                          <p className="text-[10px] text-slate-400">of ${(r.grandTotal ?? r.total ?? 0).toFixed(2)}</p>
                        </>
                      ) : (
                        <p className="font-bold text-slate-800 text-sm">${(r.grandTotal ?? r.total ?? 0).toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}

              {matchedSwUsd.map(e => (
                <div key={e.id} className="w-full bg-white rounded-2xl p-4 border border-teal-100 shadow-sm anim-fade-up flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md"
                    style={{ background: 'linear-gradient(135deg, #14b8a6, #0ea5e9)' }}>
                    <Users size={18} color="#fff" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{e.description || 'Splitwise expense'}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-slate-400">{e.date}</span>
                      <span className="text-slate-200">·</span>
                      <span className="text-xs font-semibold" style={{ color: TEAL }}>Splitwise</span>
                      {e.addedBy && (
                        <>
                          <span className="text-slate-200">·</span>
                          <span className="text-xs text-slate-400 truncate">Added By {e.addedBy}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-slate-800 text-sm">${e.myOwedShare.toFixed(2)}</p>
                    {e.cost > e.myOwedShare && (
                      <p className="text-[10px] text-slate-400">of ${e.cost.toFixed(2)}</p>
                    )}
                  </div>
                </div>
              ))}

              {matchedSwForeign.map(e => (
                <div key={e.id} className="w-full bg-white rounded-2xl p-4 border border-amber-100 shadow-sm anim-fade-up flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md"
                    style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}>
                    <Users size={18} color="#fff" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{e.description || 'Splitwise expense'}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-slate-400">{e.date}</span>
                      <span className="text-slate-200">·</span>
                      <span className="text-xs font-semibold text-amber-500">Splitwise · {e.currency_code}</span>
                      {e.addedBy && (
                        <>
                          <span className="text-slate-200">·</span>
                          <span className="text-xs text-slate-400 truncate">Added By {e.addedBy}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-slate-800 text-sm">{formatWithCurrency(e.myOwedShare, e.currency_code)}</p>
                    {e.cost > e.myOwedShare && (
                      <p className="text-[10px] text-slate-400">of {formatWithCurrency(e.cost, e.currency_code)}</p>
                    )}
                  </div>
                </div>
              ))}

              {matchedBank.map(t => (
                <div key={t.id} className="w-full bg-white rounded-2xl p-4 border border-slate-100 shadow-sm anim-fade-up flex items-center gap-3">
                  <span className="text-lg shrink-0">{getCategoryIcon(t.category)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">{t.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-400">{formatShortDate(t.date)}</span>
                      <span className="text-slate-200">·</span>
                      <span className="text-xs text-slate-400">Bank · {t.sourceName || t.source}</span>
                    </div>
                  </div>
                  <span className="font-bold text-slate-800 text-sm shrink-0">{formatCurrency(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
