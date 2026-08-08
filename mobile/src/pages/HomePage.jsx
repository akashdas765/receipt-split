import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, LogOut, Trash2, CheckCheck, AlertTriangle, X, Users, AlertCircle, Landmark, CreditCard, Loader2 } from 'lucide-react';
import { logout } from '../services/auth';
import { loadReceiptsForInsights, deleteReceipt } from '../services/db';
import { fetchCurrentUser, fetchAllExpenses, fetchGroups, fetchNetBalance } from '../services/splitwise';
import { fetchAccountBalances } from '../services/plaid';
import { session } from '../services/session';
import { getMonthRange } from '../utils/statementFormatters';
import BottomNav from '../components/BottomNav';
import MonthSlider from '../components/MonthSlider';

const INDIGO = '#6366f1';
const EMERALD = '#10b981';
const TEAL   = '#14b8a6';

function formatWithCurrency(amount, currencyCode) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
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
  // Splitwise expenses logged in a currency other than USD (e.g. a trip
  // paid in INR) — kept separate from splitwiseExpenses so they never get
  // silently summed into the $ totals below (see fetchAllExpenses), but
  // still shown in the list, in their own currency, clearly marked.
  const [otherCurrencyExpenses, setOtherCurrencyExpenses] = useState([]);
  const [loadingSw,         setLoadingSw]         = useState(true);

  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [confirmTarget, setConfirmTarget] = useState(null); // { id, merchant } | null
  const [deleting,      setDeleting]      = useState(false);

  // Surfaced instead of silently swallowed — if this fails, myId never
  // resolves, which silently zeroes "Your share" (personTotals lookups all
  // short-circuit) and skips Splitwise-only expenses entirely, with no
  // other indication anything went wrong.
  const [swAuthError, setSwAuthError] = useState('');

  // Net worth card: live Plaid balances (per account, tagged bank/credit
  // via PlaidConnect.jsx's classification) + Splitwise's own net balance.
  // Point-in-time, not month-scoped — unlike everything else on this page,
  // it deliberately doesn't depend on currentMonth.
  const [plaidBalances,   setPlaidBalances]   = useState([]); // [{id, current, isoCurrencyCode, accountType}]
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [balanceError,    setBalanceError]    = useState('');
  const [splitwiseNet,    setSplitwiseNet]    = useState(0);
  const [loadingNet,      setLoadingNet]      = useState(true);

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
    fetchNetBalance().then(setSplitwiseNet).catch(() => {}).finally(() => setLoadingNet(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const connections = session.getPlaidConnections();
      if (!connections.length) { setLoadingBalances(false); return; }
      setLoadingBalances(true);
      const results = await Promise.allSettled(
        connections.map(conn => fetchAccountBalances(conn.accessToken).then(balances => ({ conn, balances })))
      );
      if (cancelled) return;
      const flat = [];
      const failures = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status !== 'fulfilled') {
          // Institution name + the real Plaid error (e.g.
          // ITEM_LOGIN_REQUIRED) instead of a generic banner — otherwise
          // "some accounts failed" gives no way to tell which one or why.
          failures.push(`${connections[i].institutionName || 'a connection'}: ${r.reason?.message || 'unknown error'}`);
          continue;
        }
        const { conn, balances } = r.value;
        const accountMeta = conn.accounts || [];
        for (const b of balances) {
          const meta = accountMeta.find(a => a.id === b.id);
          // Falls back to Plaid's own type if the account was never opened
          // in PlaidConnect's chip UI yet (so its default classification —
          // see defaultAccountType there — was never persisted).
          const accountType = meta?.accountType
            || (b.type === 'depository' ? 'bank' : b.type === 'credit' ? 'credit' : undefined);
          flat.push({ id: b.id, current: b.current, isoCurrencyCode: b.isoCurrencyCode, accountType });
        }
      }
      setPlaidBalances(flat);
      if (failures.length) setBalanceError(failures.join(' · '));
      setLoadingBalances(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    const { start, end } = getMonthRange(currentMonth);
    setLoadingSw(true);
    fetchAllExpenses(myId, { datedAfter: start, datedBefore: end })
      .then(({ expenses, otherCurrencyExpenses }) => {
        if (cancelled) return;
        setSplitwiseExpenses(expenses);
        setOtherCurrencyExpenses(otherCurrencyExpenses);
      })
      .catch(() => { if (!cancelled) { setSplitwiseExpenses([]); setOtherCurrencyExpenses([]); } })
      .finally(() => { if (!cancelled) setLoadingSw(false); });
    return () => { cancelled = true; };
  }, [myId, currentMonth]);

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

  // Same as splitwiseOnly, but never summed into any $ total below — see
  // the currency_code split in fetchAllExpenses.
  const foreignCurrencyOnly = useMemo(() =>
    otherCurrencyExpenses.filter(e => e.myOwedShare > 0 && !postedExpenseIds.has(e.id)),
    [otherCurrencyExpenses, postedExpenseIds]
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

  const monthCount = monthlyReceipts.length + splitwiseOnly.length + foreignCurrencyOnly.length;

  // Net worth = cash on hand + what you're owed - what you owe. Credit
  // card `current` balance is what you owe on it (a liability), so it
  // subtracts rather than adds — the whole reason PlaidConnect.jsx's
  // bank-vs-credit-card tag exists. Non-USD balances are excluded from
  // both sums for the same reason fetchAllExpenses splits currencies —
  // blending them in would silently misreport the total.
  const hasPlaidAccounts = session.getPlaidConnections().length > 0;
  const bankTotal = useMemo(() =>
    plaidBalances
      .filter(b => b.accountType === 'bank' && b.isoCurrencyCode === 'USD' && b.current != null)
      .reduce((s, b) => s + b.current, 0),
    [plaidBalances]
  );
  const creditDebtTotal = useMemo(() =>
    plaidBalances
      .filter(b => b.accountType === 'credit' && b.isoCurrencyCode === 'USD' && b.current != null)
      .reduce((s, b) => s + b.current, 0),
    [plaidBalances]
  );
  const netWorth = bankTotal - creditDebtTotal + splitwiseNet;

  const reloadMonth = () => {
    if (!myId) return;
    setLoadingSw(true);
    fetchAllExpenses(myId, { datedAfter: monthRange.start, datedBefore: monthRange.end })
      .then(({ expenses, otherCurrencyExpenses }) => {
        setSplitwiseExpenses(expenses);
        setOtherCurrencyExpenses(otherCurrencyExpenses);
      })
      .catch(() => { setSplitwiseExpenses([]); setOtherCurrencyExpenses([]); })
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
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <MonthSlider currentMonth={currentMonth} onChange={setCurrentMonth} />

      {/* Body */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 pb-24">
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

            {/* Net worth — bank balances + Splitwise net position, live from
                Plaid/Splitwise rather than anything stored, since a stale
                number here would be actively misleading. Point-in-time, not
                scoped to the month slider above. */}
            {hasPlaidAccounts && (
              <div
                className="rounded-2xl p-4 mb-4 border border-emerald-100 anim-fade-up"
                style={{ background: 'linear-gradient(135deg, #ecfdf5, #f0fdfa)' }}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Net worth</p>
                  {(loadingBalances || loadingNet) && <Loader2 size={12} className="animate-spin text-slate-400" />}
                </div>
                <p className="text-2xl font-extrabold text-slate-800">{formatWithCurrency(netWorth, 'USD')}</p>

                <div className="mt-3 pt-3 border-t border-emerald-100/60 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-slate-500"><Landmark size={12} /> Bank balance</span>
                    <span className="font-semibold text-slate-700">{formatWithCurrency(bankTotal, 'USD')}</span>
                  </div>
                  {creditDebtTotal > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-slate-500"><CreditCard size={12} /> Credit card debt</span>
                      <span className="font-semibold text-red-500">{formatWithCurrency(-creditDebtTotal, 'USD')}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-slate-500"><Users size={12} /> Splitwise</span>
                    <span className={`font-semibold ${splitwiseNet >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {splitwiseNet >= 0 ? '+' : ''}{formatWithCurrency(splitwiseNet, 'USD')}
                    </span>
                  </div>
                </div>
                {balanceError && <p className="text-[10px] text-amber-500 mt-2">{balanceError}</p>}
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

                {/* Splitwise expenses logged in a non-USD currency — shown
                    so they're not silently missing, but never folded into
                    the $ totals above (mixing currencies would misreport
                    them, e.g. a ₹3600 expense is not $3600). */}
                {foreignCurrencyOnly.map(e => (
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
                        {groupName(e.group_id) && (
                          <>
                            <span className="text-slate-200">·</span>
                            <span className="text-xs text-slate-400 truncate">{groupName(e.group_id)}</span>
                          </>
                        )}
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
                      <p className="text-[10px] text-amber-500">not in totals</p>
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

      <BottomNav />
    </div>
  );
}
