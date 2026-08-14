import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CloudUpload, AlertCircle, CheckCircle2, Loader2, Equal } from 'lucide-react';
import { postExpense, fetchCurrentUser } from '../services/splitwise';
import { saveReceipt, setTransactionOverride, logNotification } from '../services/db';
import { memberColor } from '../utils/memberColor';
import PageHeader from '../components/PageHeader';
import TransactionPickerModal from '../components/TransactionPickerModal';

const INDIGO = '#6366f1';

function equalSplit(total, ids) {
  if (!ids.length) return {};
  const each     = Math.floor(total * 100 / ids.length) / 100;
  const remainder = Math.round((total - each * ids.length) * 100) / 100;
  return Object.fromEntries(ids.map((id, i) => [id, (i === 0 ? each + remainder : each).toFixed(2)]));
}

// Round each person's owed share to the cent, then push any leftover cents
// (from rounding each share independently) onto the largest share so the
// sum matches the rounded grand total exactly. Splitwise computes its own
// "cost" as the sum of these shares — without this correction, that sum can
// differ from what our own "Balanced" check compares against (grandTotal),
// causing Splitwise to reject the expense even though our UI says balanced.
function roundShares(shares, total) {
  const ids = Object.keys(shares);
  if (!ids.length) return {};
  const rounded = {};
  let sum = 0;
  ids.forEach(id => {
    const r = Math.round(shares[id] * 100) / 100;
    rounded[id] = r;
    sum += r;
  });
  const target = Math.round(total * 100) / 100;
  const diff   = Math.round((target - sum) * 100) / 100;
  if (diff !== 0) {
    const maxId = ids.reduce((a, b) => (rounded[a] >= rounded[b] ? a : b));
    rounded[maxId] = Math.round((rounded[maxId] + diff) * 100) / 100;
  }
  return rounded;
}

export default function ApprovePage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { receiptId, groupId, members = [], items = [], personTotals = {}, grandTotal = 0, merchant, existingExpenseId } = state || {};

  const buildNote = () => {
    const memberMap = {};
    members.forEach(m => { memberMap[String(m.id)] = m.name; });
    return items
      .filter(i => {
        const shares = i.split_shares || {};
        return Object.keys(shares).some(id => shares[id] > 0) || (i.split_members || []).length > 0;
      })
      .map(i => {
        const shares    = i.split_shares || {};
        const memberIds = Object.keys(shares).length > 0
          ? Object.keys(shares).filter(id => shares[id] > 0)
          : (i.split_members || []);
        const names = memberIds.map(id => {
          const name  = memberMap[id] || id;
          const count = shares[id];
          return count && count > 1 ? `${name} ×${count}` : name;
        }).join(', ');
        return `${i.description} ($${parseFloat(i.amount || 0).toFixed(2)}) — ${names}`;
      })
      .join('\n');
  };

  const [paidAmounts, setPaidAmounts] = useState({});
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState('');
  // Set once postExpense succeeds — switches the page into the "match this
  // to a bank transaction?" step instead of navigating away immediately.
  const [postedExpense, setPostedExpense] = useState(null);
  const [myId, setMyId] = useState(null);

  useEffect(() => {
    fetchCurrentUser().then(u => setMyId(u.id)).catch(() => {});
  }, []);

  const payerIds = Object.keys(paidAmounts);

  const togglePayer = (memberId) => {
    const mid = String(memberId);
    const next = { ...paidAmounts };
    if (next[mid] !== undefined) {
      delete next[mid];
    } else {
      next[mid] = '0.00';
    }
    // Reset to equal split among remaining payers
    const newIds = Object.keys(next);
    setPaidAmounts(equalSplit(grandTotal, newIds));
    setError('');
  };

  const resetEqual = () => {
    if (!payerIds.length) return;
    setPaidAmounts(equalSplit(grandTotal, payerIds));
  };

  const updateAmount = (memberId, value) => {
    setPaidAmounts(prev => ({ ...prev, [String(memberId)]: value }));
    setError('');
  };

  const totalPaid     = payerIds.reduce((s, id) => s + (parseFloat(paidAmounts[id]) || 0), 0);
  const paidDiff      = Math.round((totalPaid - grandTotal) * 100) / 100;
  const paidBalanced  = Math.abs(paidDiff) < 0.02;

  const membersWithAmounts = members
    .map(m => ({ ...m, amount: personTotals[String(m.id)] || 0 }))
    .filter(m => m.amount > 0);

  const submit = async () => {
    if (!payerIds.length) { setError('Please choose who paid the bill.'); return; }
    if (!paidBalanced) {
      setError(`Paid amounts are $${Math.abs(paidDiff).toFixed(2)} ${paidDiff > 0 ? 'over' : 'under'} the total.`);
      return;
    }
    setError(''); setSubmitting(true);
    try {
      // Include payers even if they weren't assigned any items (owed_share
      // will be 0) — otherwise their paid_share is silently omitted from the
      // Splitwise request and the expense fails to balance.
      const payerIdSet     = new Set(payerIds);
      const activeMembers  = members.filter(m => (personTotals[String(m.id)] || 0) > 0 || payerIdSet.has(String(m.id)));
      const paidAmountsNum = roundShares(
        Object.fromEntries(payerIds.map(id => [id, parseFloat(paidAmounts[id]) || 0])),
        grandTotal
      );
      const expense = await postExpense({
        description:  merchant || 'Receipt',
        details:      buildNote(),
        groupId,
        paidAmounts:  paidAmountsNum,
        personTotals: roundShares(personTotals, grandTotal),
        members: activeMembers,
        expenseId: existingExpenseId || undefined,
      });
      // Only mark a receipt "posted" when Splitwise actually gave back a
      // transaction id — that id is the proof, not just a resolved promise.
      if (!expense?.id) throw new Error('Splitwise did not confirm the expense was created.');
      if (receiptId) {
        await saveReceipt({ ...state, id: receiptId, approved: true, splitwise_expense_id: expense.id });
      }
      // existingExpenseId means this was a re-post/edit of an already-posted
      // receipt, not a new one — only the first post is worth a notification.
      if (!existingExpenseId) {
        logNotification({
          type: 'receipt_posted',
          text: `${merchant || 'Receipt'} ($${grandTotal.toFixed(2)}) was posted to Splitwise`,
          receiptId,
        }).catch(() => {});
      }
      // Offer to match this to a bank transaction instead of navigating away
      // immediately — otherwise the receipt and its card charge show up as
      // two separate unmatched things next time Statements is opened.
      setPostedExpense(expense);
    } catch (err) {
      setError(err?.message || 'Could not post to Splitwise. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // txn: the bank transaction picked in TransactionPickerModal. Same
  // override-field mechanism StatementsPage uses for manual links —
  // appended (not overwritten) in case that transaction was already linked
  // to something else, same reasoning as StatementsPage's multi-link support.
  const handleMatchTransaction = async (txn) => {
    const myOwedShare = parseFloat(
      (postedExpense.users || []).find(u => String(u.user_id) === String(myId))?.owed_share || 0
    );
    const existingIds  = txn.overrideSplitwiseIds || (txn.overrideSplitwiseId ? [txn.overrideSplitwiseId] : []);
    const existingData = txn.overrideExpenseDataList || (txn.overrideExpenseData ? [txn.overrideExpenseData] : []);
    const snapshot = {
      id:          postedExpense.id,
      description: postedExpense.description || merchant || 'Receipt',
      date:        postedExpense.date || null,
      group_id:    groupId,
      myOwedShare,
      cost:        parseFloat(postedExpense.cost != null ? postedExpense.cost : grandTotal),
    };
    await setTransactionOverride(txn.id, {
      overrideSplitwiseIds:    [...existingIds, postedExpense.id],
      overrideExpenseDataList: [...existingData, snapshot],
      overrideSplitwiseId:     null,
      overrideExpenseData:     null,
      overrideForcedUnmatched: null,
    });
    navigate('/');
  };

  if (!state) { navigate('/'); return null; }

  if (postedExpense) {
    return (
      <div className="min-h-screen flex flex-col aurora-bg items-center justify-center px-4">
        <div className="text-center anim-scale-in">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 tint-emerald-badge">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <p className="font-extrabold text-ink text-lg mb-1">
            {existingExpenseId ? 'Expense updated!' : 'Posted to Splitwise!'}
          </p>
          <p className="text-sm text-subtle">Checking for a matching bank transaction…</p>
        </div>
        <TransactionPickerModal
          expense={postedExpense}
          onSelect={handleMatchTransaction}
          onSkip={() => navigate('/')}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      {/* Header */}
      <PageHeader title={existingExpenseId ? 'Review & Update' : 'Review & Post'} />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-28 space-y-5">

          {/* Total card */}
          <div className="bg-surface rounded-3xl p-6 flex flex-col items-center border border-edge shadow-sm anim-scale-in"
            style={{ boxShadow: '0 16px 40px rgba(99,102,241,0.10)' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 anim-float tint-indigo-badge">
              <CloudUpload size={26} style={{ color: INDIGO }} />
            </div>
            <p className="font-bold text-muted text-sm mb-1">{merchant || 'Receipt'}</p>
            <p className="font-extrabold text-4xl mb-1 text-gradient">${grandTotal.toFixed(2)}</p>
            <p className="text-xs text-subtle">Total including tax</p>
          </div>

          {/* Split breakdown */}
          <div className="anim-fade-up delay-1">
            <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Split breakdown</p>
            {membersWithAmounts.length === 0 ? (
              <div className="bg-surface rounded-2xl p-4 border border-edge shadow-sm flex items-center gap-3">
                <AlertCircle size={18} className="text-subtle shrink-0" />
                <p className="text-sm text-subtle">No items assigned — go back and assign members to items.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 stagger">
                {membersWithAmounts.map(m => {
                  const color = memberColor(m.id, members);
                  return (
                    <div key={m.id} className="bg-surface rounded-xl px-4 py-3 flex items-center gap-3 border border-edge shadow-sm anim-fade-up card-lift">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-extrabold text-sm shrink-0"
                        style={{ background: color }}>
                        {m.name?.[0]?.toUpperCase()}
                      </div>
                      <span className="flex-1 font-semibold text-sm text-ink">{m.name}</span>
                      <span className="font-extrabold text-base" style={{ color }}>${m.amount.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Who paid */}
          <div className="anim-fade-up delay-2">
            <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Who paid?</p>
            <div className="flex flex-wrap gap-2">
              {members.map(m => {
                const mid      = String(m.id);
                const color    = memberColor(m.id, members);
                const selected = paidAmounts[mid] !== undefined;
                return (
                  <button key={m.id} onClick={() => togglePayer(m.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 font-semibold text-sm transition-all btn-press ${selected ? 'anim-pop' : ''}`}
                    style={selected
                      ? { borderColor: color, background: color + '18', color, boxShadow: `0 4px 14px ${color}33` }
                      : { borderColor: '#e2e8f0', background: '#fff', color: '#64748b' }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-extrabold shrink-0"
                      style={{ background: color }}>
                      {m.name?.[0]?.toUpperCase()}
                    </div>
                    {m.name}
                    {selected && <CheckCircle2 size={14} style={{ color }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payment split amounts */}
          {payerIds.length > 0 && (
            <div className="anim-fade-up">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-muted uppercase tracking-wide">Payment split</p>
                {payerIds.length > 1 && (
                  <button onClick={resetEqual}
                    className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg transition-colors hover:bg-indigo-50"
                    style={{ color: INDIGO }}>
                    <Equal size={12} /> Equal
                  </button>
                )}
              </div>

              <div className="bg-surface rounded-2xl border border-edge shadow-sm overflow-hidden">
                {payerIds.map((mid, idx) => {
                  const m     = members.find(m => String(m.id) === mid);
                  const color = memberColor(mid, members);
                  return (
                    <div key={mid}
                      className={`flex items-center gap-3 px-4 py-3 ${idx < payerIds.length - 1 ? 'border-b border-edge' : ''}`}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-extrabold text-xs shrink-0"
                        style={{ background: color }}>
                        {m?.name?.[0]?.toUpperCase()}
                      </div>
                      <span className="flex-1 font-semibold text-sm text-ink">{m?.name}</span>
                      <div className="flex items-center gap-1 bg-surface-alt border border-edge rounded-lg px-2 py-1.5">
                        <span className="text-xs text-subtle font-semibold">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={paidAmounts[mid]}
                          onChange={e => updateAmount(mid, e.target.value)}
                          className="w-20 text-sm font-bold text-ink bg-transparent outline-none text-right"
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Running total */}
                <div className={`flex items-center justify-between px-4 py-2.5 border-t transition-colors duration-300 ${paidBalanced ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
                  <span className={`text-xs font-bold ${paidBalanced ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {paidBalanced ? 'Balanced' : paidDiff > 0 ? `$${paidDiff.toFixed(2)} over` : `$${Math.abs(paidDiff).toFixed(2)} remaining`}
                  </span>
                  <span className={`text-xs font-extrabold ${paidBalanced ? 'text-emerald-600' : 'text-amber-600'}`}>
                    ${totalPaid.toFixed(2)} / ${grandTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-10 glass-footer">
        <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2 anim-pop">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600 font-medium">{error}</p>
            </div>
          )}
          <button onClick={submit} disabled={submitting}
            className="w-full py-3.5 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2 btn-gradient btn-press disabled:opacity-80">
            {submitting
              ? <><Loader2 size={20} className="animate-spin" /> {existingExpenseId ? 'Updating…' : 'Posting…'}</>
              : <><CloudUpload size={20} /> {existingExpenseId ? 'Update Splitwise Expense' : 'Post to Splitwise'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
