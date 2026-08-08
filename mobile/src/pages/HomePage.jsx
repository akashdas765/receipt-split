import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, LogOut, Plus, Trash2, CheckCheck, AlertTriangle, X, TrendingUp, Landmark, Users, AlertCircle } from 'lucide-react';
import { logout } from '../services/auth';
import { loadReceiptsForInsights, deleteReceipt } from '../services/db';
import { fetchCurrentUser, fetchAllExpenses, fetchGroups } from '../services/splitwise';
import { getMonthRange } from '../utils/statementFormatters';

const INDIGO = '#6366f1';
const EMERALD = '#10b981';
const TEAL   = '#14b8a6';

const MONTHS_WINDOW = 12; // trailing window shown in the month slider

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export default function HomePage() {
  const navigate = useNavigate();

  // Receipts (added through this app) — loaded once, filtered to the
  // selected month client-side (same 200-receipt window Insights uses).
  const [receipts,        setReceipts]        = useState([]);
  const [loadingReceipts, setLoadingReceipts]  = useState(true);

  // Full Splitwise history — re-fetched per selected month, so it covers
  // expenses added any way (not just receipts posted through this app).
  const [myId,             setMyId]             = useState(null);
  const [groups,            setGroups]           = useState([]);
  const [splitwiseExpenses, setSplitwiseExpenses] = useState([]);
  const [loadingSw,         setLoadingSw]         = useState(true);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const sliderRef = useRef(null);

  const [confirmTarget, setConfirmTarget] = useState(null); // { id, merchant } | null
  const [deleting,      setDeleting]      = useState(false);

  // Surfaced instead of silently swallowed — if this fails, myId never
  // resolves, which silently zeroes "Your share" (personTotals lookups all
  // short-circuit) and skips Splitwise-only expenses entirely, with no
  // other indication anything went wrong.
  const [swAuthError, setSwAuthError] = useState('');

  useEffect(() => {
    loadReceiptsForInsights().then(list => { setReceipts(list); setLoadingReceipts(false); });
    fetchGroups().then(setGroups).catch(() => {});
    fetchCurrentUser()
      .then(u => setMyId(u.id))
      .catch(err => {
        // Without myId the Splitwise-fetch effect below never runs (it's
        // gated on myId being set), so loadingSw would otherwise stay true
        // forever — stop it here instead of leaving the skeleton spinning.
        setLoadingSw(false);
        setSwAuthError(err?.message || 'Could not connect to Splitwise — your share and Splitwise expenses won\'t show until this is fixed.');
      });
  }, []);

  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    const { start, end } = getMonthRange(currentMonth);
    setLoadingSw(true);
    fetchAllExpenses(myId, { datedAfter: start, datedBefore: end })
      .then(({ expenses }) => { if (!cancelled) setSplitwiseExpenses(expenses); })
      .catch(() => { if (!cancelled) setSplitwiseExpenses([]); })
      .finally(() => { if (!cancelled) setLoadingSw(false); });
    return () => { cancelled = true; };
  }, [myId, currentMonth]);

  // Trailing 12 months for the slider, oldest first — "today" is always
  // the last (rightmost) option.
  const monthOptions = useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTHS_WINDOW }, (_, i) =>
      new Date(now.getFullYear(), now.getMonth() - (MONTHS_WINDOW - 1 - i), 1)
    );
  }, []);

  useEffect(() => {
    sliderRef.current?.scrollTo({ left: sliderRef.current.scrollWidth });
  }, []);

  const monthRange = useMemo(() => getMonthRange(currentMonth), [currentMonth]);

  const monthlyReceipts = useMemo(() =>
    receipts.filter(r => {
      const d = (r.date || r.scanned_at || '').slice(0, 10);
      return d >= monthRange.start && d <= monthRange.end;
    }),
    [receipts, monthRange]
  );

  // A receipt posted through this app IS a Splitwise expense — exclude
  // those from the "pure Splitwise" list so they don't show up twice.
  const postedExpenseIds = useMemo(() =>
    new Set(receipts.filter(r => r.approved && r.splitwise_expense_id).map(r => r.splitwise_expense_id)),
    [receipts]
  );

  const splitwiseOnly = useMemo(() =>
    splitwiseExpenses.filter(e => e.myOwedShare > 0 && !postedExpenseIds.has(e.id)),
    [splitwiseExpenses, postedExpenseIds]
  );

  const groupName = id => groups.find(g => g.id === id)?.name;

  const approvedMonthlyReceipts = useMemo(() => monthlyReceipts.filter(r => r.approved), [monthlyReceipts]);
  const pendingMonthlyReceipts  = useMemo(() => monthlyReceipts.filter(r => !r.approved), [monthlyReceipts]);

  // "Your share" — approved receipts contribute their actual split amount
  // (personTotals, set at approval — see ApprovePage), not the full group
  // total, plus every Splitwise-only expense's owed share. Pending receipts
  // aren't split yet, so their "my share" isn't knowable — kept out of this
  // total and shown separately below instead of silently inflating it with
  // a full amount that isn't really "my spend" yet.
  const myShareTotal =
    approvedMonthlyReceipts.reduce((s, r) => s + (myId && r.personTotals?.[myId] || 0), 0) +
    splitwiseOnly.reduce((s, e) => s + (e.myOwedShare || 0), 0);
  const myShareCount = approvedMonthlyReceipts.length + splitwiseOnly.length;

  const pendingTotal = pendingMonthlyReceipts.reduce((s, r) => s + (r.grandTotal ?? r.total ?? 0), 0);

  const monthCount = monthlyReceipts.length + splitwiseOnly.length;

  const reloadMonth = () => {
    if (!myId) return;
    setLoadingSw(true);
    fetchAllExpenses(myId, { datedAfter: monthRange.start, datedBefore: monthRange.end })
      .then(({ expenses }) => setSplitwiseExpenses(expenses))
      .catch(() => setSplitwiseExpenses([]))
      .finally(() => setLoadingSw(false));
    loadReceiptsForInsights().then(setReceipts);
  };

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    setDeleting(true);
    await deleteReceipt(confirmTarget.id);
    setReceipts(r => r.filter(x => x.id !== confirmTarget.id));
    setDeleting(false);
    setConfirmTarget(null);
  };

  const handleLogout = async () => {
    await logout();
  };

  const loading = loadingReceipts;

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      {/* Delete confirmation modal */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 anim-fade-in"
          onClick={() => !deleting && setConfirmTarget(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl anim-sheet-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <AlertTriangle size={18} className="text-red-500" />
                </div>
                <h3 className="font-extrabold text-slate-800 text-base">Remove receipt?</h3>
              </div>
              <button onClick={() => setConfirmTarget(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-5">
              This will permanently remove <span className="font-semibold text-slate-700">{confirmTarget.merchant || 'this receipt'}</span> from your history.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmTarget(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors btn-press disabled:opacity-60">
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-red-500 hover:bg-red-600 transition-colors btn-press disabled:opacity-60">
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 glass">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center logo-glow">
              <Receipt size={15} color="#fff" />
            </div>
            <span className="font-extrabold text-gradient text-base tracking-tight">ReceiptSplit</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/statements')}
              className="p-2 rounded-lg text-indigo-400 hover:bg-indigo-50 transition-colors"
              title="Statements"
            >
              <Landmark size={18} />
            </button>
            <button
              onClick={() => navigate('/insights')}
              className="p-2 rounded-lg text-indigo-400 hover:bg-indigo-50 transition-colors"
              title="Insights"
            >
              <TrendingUp size={18} />
            </button>
            <button
              onClick={() => navigate('/scan')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-white text-sm font-bold btn-gradient btn-press"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Scan Receipt</span>
              <span className="sm:hidden">Scan</span>
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Month slider */}
      <div className="sticky top-14 z-10 glass border-t border-slate-100/60">
        <div ref={sliderRef} className="max-w-2xl mx-auto flex gap-2 overflow-x-auto px-4 py-2.5">
          {monthOptions.map(d => {
            const selected = isSameMonth(d, currentMonth);
            return (
              <button
                key={d.toISOString()}
                onClick={() => setCurrentMonth(d)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors btn-press ${selected ? 'text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-200'}`}
                style={selected ? { background: INDIGO } : {}}
              >
                {d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4">
        {loading ? (
          <div className="flex flex-col gap-3 pt-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl p-4 bg-white border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl skeleton shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/2 rounded-full skeleton" />
                    <div className="h-3 w-3/4 rounded-full skeleton" />
                  </div>
                  <div className="h-4 w-14 rounded-full skeleton shrink-0" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {swAuthError && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4 anim-pop">
                <AlertCircle size={15} className="text-red-500 shrink-0" />
                <p className="text-sm text-red-600 font-medium">{swAuthError}</p>
              </div>
            )}

            {/* Month total */}
            <div
              className="rounded-2xl p-4 mb-4 border border-indigo-100 anim-fade-up"
              style={{ background: 'linear-gradient(135deg, #eef1fb, #f5f0fe)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">{monthRange.label}</p>
                  <p className="text-2xl font-extrabold text-slate-800">${myShareTotal.toFixed(2)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Your share · {myShareCount} transaction{myShareCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={reloadMonth}
                  className="text-xs font-bold shrink-0 transition-colors"
                  style={{ color: INDIGO }}
                >
                  Refresh
                </button>
              </div>

              {pendingMonthlyReceipts.length > 0 && (
                <div className="mt-3 pt-3 border-t border-indigo-100/60 flex items-center justify-between gap-3">
                  <span className="text-xs font-bold" style={{ color: '#f59e0b' }}>
                    +${pendingTotal.toFixed(2)} pending
                  </span>
                  <span className="text-xs text-slate-400">
                    {pendingMonthlyReceipts.length} not yet split — not counted above
                  </span>
                </div>
              )}
            </div>

            {monthCount === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center anim-scale-in">
                <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center mb-4 anim-float">
                  <Receipt size={36} style={{ color: '#a5b4fc' }} />
                </div>
                <h2 className="text-lg font-bold text-slate-500 mb-1">Nothing in {monthRange.label}</h2>
                <p className="text-sm text-slate-400">Scan a receipt or pick another month</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 stagger">
                {monthlyReceipts.map(r => (
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
                        {r.approved
                          ? <CheckCheck size={18} color="#fff" />
                          : <Receipt size={18} color="#fff" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 text-sm truncate">
                          {r.merchant || 'Unknown merchant'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-slate-400">
                            {r.date || r.scanned_at?.slice(0, 10)}
                          </span>
                          <span className="text-slate-200">·</span>
                          <span className="text-xs font-semibold" style={{ color: r.approved ? EMERALD : '#f59e0b' }}>
                            {r.approved ? 'Posted' : 'Pending'}
                          </span>
                          <span className="text-slate-200">·</span>
                          <span className="text-xs text-slate-400">{r.items?.length || 0} items</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          {r.approved && myId && r.personTotals?.[myId] != null ? (
                            <>
                              <p className="font-bold text-slate-800 text-sm">${r.personTotals[myId].toFixed(2)}</p>
                              <p className="text-[10px] text-slate-400">of ${(r.grandTotal ?? r.total ?? 0).toFixed(2)}</p>
                            </>
                          ) : (
                            <p className="font-bold text-slate-800 text-sm">${(r.grandTotal ?? r.total ?? 0).toFixed(2)}</p>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmTarget({ id: r.id, merchant: r.merchant }); }}
                          className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </button>
                ))}

                {/* Splitwise expenses not added through this app — visually
                    distinct (teal, Users icon, "Splitwise" badge) so it's
                    clear these weren't scanned here. */}
                {splitwiseOnly.map(e => (
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
                        {groupName(e.group_id) && (
                          <>
                            <span className="text-slate-200">·</span>
                            <span className="text-xs text-slate-400 truncate">{groupName(e.group_id)}</span>
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

                {loadingSw && (
                  <div className="rounded-2xl p-4 bg-white border border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl skeleton shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-1/2 rounded-full skeleton" />
                        <div className="h-3 w-3/4 rounded-full skeleton" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
