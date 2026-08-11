import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Settings as SettingsIcon, Trash2, CheckCheck, AlertTriangle, X, Users, AlertCircle, Landmark, CreditCard, Loader2 } from 'lucide-react';
import { loadReceiptsForInsights, deleteReceipt, saveReceipt, loadManualAccounts, saveManualAccount, deleteManualAccount } from '../services/db';
import { fetchCurrentUser, fetchAllExpenses, fetchGroups, fetchNetBalance } from '../services/splitwise';
import { fetchAccountBalances } from '../services/plaid';
import { session } from '../services/session';
import { accountLabel } from '../utils/accountLabel';
import { getCategoryIcon } from '../utils/categoryDetector';
import { getMonthRange } from '../utils/statementFormatters';
import { maybeShowPendingReminder } from '../services/pwa';
import { useToast } from '../components/ToastProvider';
import BottomNav from '../components/BottomNav';
import NetWorthDetail from '../components/NetWorthDetail';
import SplitwiseExpenseDetail from '../components/SplitwiseExpenseDetail';
import ReceiptDetail from '../components/ReceiptDetail';
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
  const toast = useToast();

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
  const [openExpense,   setOpenExpense]   = useState(null); // Splitwise-only expense being viewed | null
  const [openReceipt,   setOpenReceipt]   = useState(null); // posted receipt being viewed | null
  const [deleting,      setDeleting]      = useState(false);

  // Surfaced instead of silently swallowed — if this fails, myId never
  // resolves, which silently zeroes "Your share" (personTotals lookups all
  // short-circuit) and skips Splitwise-only expenses entirely, with no
  // other indication anything went wrong.
  const [swAuthError, setSwAuthError] = useState('');

  // Net worth card: live Plaid balances (per account, tagged bank/credit
  // via PlaidConnect.jsx's classification) + Splitwise's own net balance +
  // manually-entered accounts (rewards, cash, ... — no transaction feed).
  // Point-in-time, not month-scoped — unlike everything else on this page,
  // it deliberately doesn't depend on currentMonth.
  const [plaidBalances,   setPlaidBalances]   = useState([]); // [{id, label, institutionName, current, isoCurrencyCode, accountType}]
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [balanceError,    setBalanceError]    = useState('');
  const [splitwiseNet,    setSplitwiseNet]    = useState(0);
  const [loadingNet,      setLoadingNet]      = useState(true);
  const [manualAccounts,  setManualAccounts]  = useState([]);
  const [netWorthOpen,    setNetWorthOpen]    = useState(false);

  useEffect(() => {
    loadReceiptsForInsights().then(list => { setReceipts(list); setLoadingReceipts(false); });
    fetchGroups().then(setGroups).catch(() => toast.error('Could not load your Splitwise groups'));
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
    loadManualAccounts().then(setManualAccounts).catch(() => toast.error('Could not load your manual accounts'));
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
          flat.push({
            id:              b.id,
            label:           accountLabel({ name: b.name, mask: b.mask, nickname: meta?.nickname }),
            institutionName: conn.institutionName,
            current:         b.current,
            isoCurrencyCode: b.isoCurrencyCode,
            accountType,
          });
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

  // Scoped to the currently-selected month, matching what's already shown
  // in the "+$X pending" line below — not "all pending receipts ever".
  useEffect(() => {
    if (loadingReceipts) return;
    maybeShowPendingReminder(pendingMonthlyReceipts.length, pendingTotal);
  }, [loadingReceipts, pendingMonthlyReceipts.length, pendingTotal]);

  const monthCount = monthlyReceipts.length + splitwiseOnly.length + foreignCurrencyOnly.length;

  // One chronological feed instead of three stacked blocks (all receipts,
  // then all Splitwise-only, then all foreign-currency) — each list was
  // already in its own date order, but stacking three separately-ordered
  // blocks isn't the same as one list actually in date order. Splitwise
  // expenses only ever carry a date (no time); receipts carry both `date`
  // and a `scanned_at` timestamp — sortKey uses whichever's available,
  // and plain string comparison works correctly across both since a
  // "YYYY-MM-DD" date sorts identically to the date-only prefix of an ISO
  // datetime string.
  const [txnFilter, setTxnFilter] = useState('all'); // 'all' | 'receipt' | 'splitwise'
  const combinedTimeline = useMemo(() => {
    const items = [
      ...monthlyReceipts.map(r => ({ kind: 'receipt', item: r, sortKey: r.date || r.scanned_at || '' })),
      ...splitwiseOnly.map(e => ({ kind: 'splitwise', item: e, sortKey: e.date || '' })),
      ...foreignCurrencyOnly.map(e => ({ kind: 'foreign', item: e, sortKey: e.date || '' })),
    ];
    items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return items;
  }, [monthlyReceipts, splitwiseOnly, foreignCurrencyOnly]);
  // "Splitwise" groups foreign-currency in with splitwise-only — both are
  // expenses that never came from a receipt scan here, just in a different
  // currency; "Posted" means receipt items regardless of posted/pending
  // sub-state (that distinction already shows as a badge on each row).
  const filteredTimeline = useMemo(() => {
    if (txnFilter === 'receipt')   return combinedTimeline.filter(t => t.kind === 'receipt');
    if (txnFilter === 'splitwise') return combinedTimeline.filter(t => t.kind !== 'receipt');
    return combinedTimeline;
  }, [combinedTimeline, txnFilter]);

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
  // Manual accounts (rewards, cash, a loan tracked by hand, ...) — no
  // transaction feed, just a name/balance/type the user enters directly.
  const manualAssetTotal = useMemo(() =>
    manualAccounts.filter(a => a.type !== 'liability').reduce((s, a) => s + (a.balance || 0), 0),
    [manualAccounts]
  );
  const manualLiabilityTotal = useMemo(() =>
    manualAccounts.filter(a => a.type === 'liability').reduce((s, a) => s + (a.balance || 0), 0),
    [manualAccounts]
  );
  const netWorth = bankTotal - creditDebtTotal + splitwiseNet + manualAssetTotal - manualLiabilityTotal;
  const hasNetWorthData = hasPlaidAccounts || manualAccounts.length > 0;

  const handleSaveManualAccount = async (fields) => {
    const id = await saveManualAccount(fields);
    setManualAccounts(prev => {
      const existing = prev.some(a => a.id === id);
      return existing
        ? prev.map(a => a.id === id ? { ...a, ...fields, id } : a)
        : [...prev, { ...fields, id }];
    });
  };

  const handleDeleteManualAccount = async (id) => {
    await deleteManualAccount(id);
    setManualAccounts(prev => prev.filter(a => a.id !== id));
  };

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
    try {
      await deleteReceipt(confirmTarget.id);
      setReceipts(r => r.filter(x => x.id !== confirmTarget.id));
      setConfirmTarget(null);
      toast.success('Receipt removed');
    } catch {
      toast.error('Could not remove receipt');
    } finally {
      setDeleting(false);
    }
  };

  // Inline category change from ReceiptDetail — no need to open the full
  // Edit form just to fix a category. saveReceipt's merge:true write only
  // touches this one field; receipts/openReceipt are both updated
  // optimistically so the pill and the list behind it agree immediately,
  // rolled back if the write fails.
  const handleChangeReceiptCategory = async (receipt, category) => {
    const previous = receipt.category;
    setReceipts(r => r.map(x => x.id === receipt.id ? { ...x, category } : x));
    setOpenReceipt(r => r && r.id === receipt.id ? { ...r, category } : r);
    try {
      await saveReceipt({ id: receipt.id, category });
    } catch {
      toast.error('Could not update category');
      setReceipts(r => r.map(x => x.id === receipt.id ? { ...x, category: previous } : x));
      setOpenReceipt(r => r && r.id === receipt.id ? { ...r, category: previous } : r);
    }
  };

  const loading = loadingReceipts;

  // Row renderers for the combined timeline below — extracted so the single
  // date-sorted map can call the right one per kind without three separate
  // stacked .map() blocks (which was the actual bug: date order within each
  // list, but not across all three together).
  const renderReceiptRow = r => (
    <button
      key={r.id}
      onClick={() => r.approved ? setOpenReceipt(r) : navigate('/detail', { state: r })}
      className="w-full text-left bg-surface rounded-2xl p-4 border border-edge shadow-sm hover:border-indigo-100 card-lift anim-fade-up"
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
          <p className="font-bold text-ink text-sm truncate">
            {r.merchant || 'Unknown merchant'}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-subtle">
              {r.date || r.scanned_at?.slice(0, 10)}
            </span>
            <span className="text-slate-200">·</span>
            <span className="text-xs font-semibold" style={{ color: r.approved ? EMERALD : '#f59e0b' }}>
              {r.approved ? 'Posted' : 'Pending'}
            </span>
            <span className="text-slate-200">·</span>
            <span className="text-xs text-subtle">{r.items?.length || 0} items</span>
            {r.category && (
              <>
                <span className="text-slate-200">·</span>
                <span className="text-xs text-subtle">{getCategoryIcon(r.category)} {r.category}</span>
              </>
            )}
            {groupName(r.groupId) && (
              <>
                <span className="text-slate-200">·</span>
                <span className="text-xs text-subtle truncate">{groupName(r.groupId)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            {r.approved && myId && r.personTotals?.[myId] != null ? (
              <>
                <p className="font-bold text-ink text-sm">${r.personTotals[myId].toFixed(2)}</p>
                <p className="text-[10px] text-subtle">of ${(r.grandTotal ?? r.total ?? 0).toFixed(2)}</p>
              </>
            ) : (
              <p className="font-bold text-ink text-sm">${(r.grandTotal ?? r.total ?? 0).toFixed(2)}</p>
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
  );

  // Splitwise expenses not added through this app — visually distinct
  // (teal, Users icon, "Splitwise" badge) so it's clear these weren't
  // scanned here.
  const renderSplitwiseRow = e => (
    <button key={e.id} onClick={() => setOpenExpense(e)}
      className="w-full text-left bg-surface rounded-2xl p-4 border border-teal-100 shadow-sm hover:border-teal-200 card-lift anim-fade-up flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md"
        style={{ background: 'linear-gradient(135deg, #14b8a6, #0ea5e9)' }}>
        <Users size={18} color="#fff" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-ink text-sm truncate">{e.description || 'Splitwise expense'}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-subtle">{e.date}</span>
          <span className="text-slate-200">·</span>
          <span className="text-xs font-semibold" style={{ color: TEAL }}>Splitwise</span>
          {groupName(e.group_id) && (
            <>
              <span className="text-slate-200">·</span>
              <span className="text-xs text-subtle truncate">{groupName(e.group_id)}</span>
            </>
          )}
          {e.addedBy && (
            <>
              <span className="text-slate-200">·</span>
              <span className="text-xs text-subtle truncate">Added By {e.addedBy}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="font-bold text-ink text-sm">${e.myOwedShare.toFixed(2)}</p>
        {e.cost > e.myOwedShare && (
          <p className="text-[10px] text-subtle">of ${e.cost.toFixed(2)}</p>
        )}
      </div>
    </button>
  );

  // Splitwise expenses logged in a non-USD currency — shown so they're not
  // silently missing, but never folded into the $ totals above (mixing
  // currencies would misreport them, e.g. a ₹3600 expense is not $3600).
  const renderForeignRow = e => (
    <button key={e.id} onClick={() => setOpenExpense(e)}
      className="w-full text-left bg-surface rounded-2xl p-4 border border-amber-100 shadow-sm hover:border-amber-200 card-lift anim-fade-up flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md"
        style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}>
        <Users size={18} color="#fff" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-ink text-sm truncate">{e.description || 'Splitwise expense'}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-subtle">{e.date}</span>
          <span className="text-slate-200">·</span>
          <span className="text-xs font-semibold text-amber-500">Splitwise · {e.currency_code}</span>
          {groupName(e.group_id) && (
            <>
              <span className="text-slate-200">·</span>
              <span className="text-xs text-subtle truncate">{groupName(e.group_id)}</span>
            </>
          )}
          {e.addedBy && (
            <>
              <span className="text-slate-200">·</span>
              <span className="text-xs text-subtle truncate">Added By {e.addedBy}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="font-bold text-ink text-sm">{formatWithCurrency(e.myOwedShare, e.currency_code)}</p>
        {e.cost > e.myOwedShare && (
          <p className="text-[10px] text-subtle">of {formatWithCurrency(e.cost, e.currency_code)}</p>
        )}
        <p className="text-[10px] text-amber-500">not in totals</p>
      </div>
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      {/* Delete confirmation modal */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 anim-fade-in"
          onClick={() => !deleting && setConfirmTarget(null)}>
          <div className="bg-surface rounded-3xl p-6 w-full max-w-sm shadow-2xl anim-sheet-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <AlertTriangle size={18} className="text-red-500" />
                </div>
                <h3 className="font-extrabold text-ink text-base">Remove receipt?</h3>
              </div>
              <button onClick={() => setConfirmTarget(null)} className="text-subtle hover:text-muted"><X size={18} /></button>
            </div>
            <p className="text-sm text-muted mb-5">
              This will permanently remove <span className="font-semibold text-ink">{confirmTarget.merchant || 'this receipt'}</span> from your history.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmTarget(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-muted bg-surface-alt hover:bg-surface-alt transition-colors btn-press disabled:opacity-60">
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
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg text-muted hover:bg-surface-alt transition-colors"
            title="Settings"
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

      <MonthSlider currentMonth={currentMonth} onChange={setCurrentMonth} />

      {/* Body */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 pb-24">
        {loading ? (
          <div className="flex flex-col gap-3 pt-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl p-4 bg-surface border border-edge">
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

            {/* Net worth — bank balances + Splitwise net position + manual
                accounts, live from Plaid/Splitwise rather than anything
                stored, since a stale number here would be actively
                misleading. Point-in-time, not scoped to the month slider
                above. Tap for the per-account breakdown. */}
            {hasNetWorthData && (
              <button
                onClick={() => setNetWorthOpen(true)}
                className="w-full text-left rounded-2xl p-4 mb-4 border border-emerald-100 anim-fade-up card-lift card-networth"
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-xs font-bold text-subtle uppercase tracking-wide">Net worth</p>
                  {(loadingBalances || loadingNet) && <Loader2 size={12} className="animate-spin text-subtle" />}
                </div>
                <p className="text-2xl font-extrabold text-ink">{formatWithCurrency(netWorth, 'USD')}</p>

                <div className="mt-3 pt-3 border-t border-emerald-100/60 space-y-1.5">
                  {hasPlaidAccounts && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted"><Landmark size={12} /> Bank balance</span>
                      <span className="font-semibold text-ink">{formatWithCurrency(bankTotal, 'USD')}</span>
                    </div>
                  )}
                  {creditDebtTotal > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted"><CreditCard size={12} /> Credit card debt</span>
                      <span className="font-semibold text-red-500">{formatWithCurrency(-creditDebtTotal, 'USD')}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted"><Users size={12} /> Splitwise</span>
                    <span className={`font-semibold ${splitwiseNet >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {splitwiseNet >= 0 ? '+' : ''}{formatWithCurrency(splitwiseNet, 'USD')}
                    </span>
                  </div>
                  {manualAccounts.length > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">Other accounts</span>
                      <span className="font-semibold text-ink">
                        {formatWithCurrency(manualAssetTotal - manualLiabilityTotal, 'USD')}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-emerald-600/70 mt-2 font-semibold">Tap for details</p>
                {balanceError && <p className="text-[10px] text-amber-500 mt-1">{balanceError}</p>}
              </button>
            )}

            {/* Month total */}
            <div
              className="rounded-2xl p-4 mb-4 border border-indigo-100 anim-fade-up card-month-total"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-subtle uppercase tracking-wide mb-1">{monthRange.label}</p>
                  <p className="text-2xl font-extrabold text-ink">${myShareTotal.toFixed(2)}</p>
                  <p className="text-xs text-subtle mt-0.5">
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
                  <span className="text-xs text-subtle">
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
                <h2 className="text-lg font-bold text-muted mb-1">Nothing in {monthRange.label}</h2>
                <p className="text-sm text-subtle">Scan a receipt or pick another month</p>
              </div>
            ) : (
              <>
                {/* Filter chips — same pill pattern as TransactionsList's */}
                <div className="flex gap-1.5 mb-3">
                  {[
                    { key: 'all',       label: 'All',       count: combinedTimeline.length },
                    { key: 'receipt',   label: 'Posted',    count: monthlyReceipts.length },
                    { key: 'splitwise', label: 'Splitwise', count: splitwiseOnly.length + foreignCurrencyOnly.length },
                  ].map(f => (
                    <button key={f.key} onClick={() => setTxnFilter(f.key)}
                      className={`flex-1 rounded-xl px-2 py-2 text-center border transition-colors ${txnFilter === f.key ? 'border-indigo-200 bg-indigo-50' : 'border-edge bg-surface hover:border-edge'}`}>
                      <p className="font-extrabold text-sm" style={{ color: txnFilter === f.key ? INDIGO : undefined }}>
                        {f.count}
                      </p>
                      <p className="text-[10px] text-subtle mt-0.5">{f.label}</p>
                    </button>
                  ))}
                </div>

                {filteredTimeline.length === 0 ? (
                  <div className="text-center py-10 text-sm text-subtle">Nothing matches this filter</div>
                ) : (
                <div className="flex flex-col gap-3 stagger">
                  {filteredTimeline.map(({ kind, item }) =>
                    kind === 'receipt'   ? renderReceiptRow(item) :
                    kind === 'splitwise' ? renderSplitwiseRow(item) :
                    renderForeignRow(item)
                  )}

                  {loadingSw && (
                    <div className="rounded-2xl p-4 bg-surface border border-edge">
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
          </>
        )}
      </main>

      {netWorthOpen && (
        <NetWorthDetail
          netWorth={netWorth}
          plaidBalances={plaidBalances}
          splitwiseNet={splitwiseNet}
          manualAccounts={manualAccounts}
          onSaveAccount={handleSaveManualAccount}
          onDeleteAccount={handleDeleteManualAccount}
          onClose={() => setNetWorthOpen(false)}
        />
      )}

      {openExpense && (
        <SplitwiseExpenseDetail
          expense={openExpense}
          groupName={groupName(openExpense.group_id)}
          onClose={() => setOpenExpense(null)}
        />
      )}

      {openReceipt && (
        <ReceiptDetail
          receipt={openReceipt}
          groupName={groupName(openReceipt.groupId)}
          onEdit={() => navigate('/detail', { state: openReceipt })}
          onClose={() => setOpenReceipt(null)}
          onChangeCategory={handleChangeReceiptCategory}
        />
      )}

      <BottomNav />
    </div>
  );
}
