import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, CloudUpload, AlertCircle, CheckCircle2, Loader2, Equal } from 'lucide-react';
import { postExpense } from '../services/splitwise';
import { saveReceipt } from '../services/db';

const INDIGO = '#6366f1';
const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#10b981','#f97316','#06b6d4','#84cc16','#a855f7'];

function memberColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

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
  const { receiptId, groupId, members = [], items = [], personTotals = {}, grandTotal = 0, merchant } = state || {};

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
      const activeMembers  = members.filter(m => (personTotals[String(m.id)] || 0) > 0);
      const paidAmountsNum = roundShares(
        Object.fromEntries(payerIds.map(id => [id, parseFloat(paidAmounts[id]) || 0])),
        grandTotal
      );
      await postExpense({
        description:  merchant || 'Receipt',
        details:      buildNote(),
        groupId,
        paidAmounts:  paidAmountsNum,
        personTotals: roundShares(personTotals, grandTotal),
        members: activeMembers,
      });
      if (receiptId) await saveReceipt({ ...state, id: receiptId, approved: true });
      navigate('/');
    } catch (err) {
      setError(err?.message || 'Could not post to Splitwise. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!state) { navigate('/'); return null; }

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      {/* Header */}
      <header className="sticky top-0 z-20 glass">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-600 btn-press">
            <ArrowLeft size={20} />
          </button>
          <span className="font-extrabold text-slate-800">Review & Post</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-28 space-y-5">

          {/* Total card */}
          <div className="bg-white rounded-3xl p-6 flex flex-col items-center border border-slate-100 shadow-sm anim-scale-in"
            style={{ boxShadow: '0 16px 40px rgba(99,102,241,0.10)' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 anim-float"
              style={{ background: 'linear-gradient(135deg, #e0e7ff, #ede9fe)' }}>
              <CloudUpload size={26} style={{ color: INDIGO }} />
            </div>
            <p className="font-bold text-slate-600 text-sm mb-1">{merchant || 'Receipt'}</p>
            <p className="font-extrabold text-4xl mb-1 text-gradient">${grandTotal.toFixed(2)}</p>
            <p className="text-xs text-slate-400">Total including tax</p>
          </div>

          {/* Split breakdown */}
          <div className="anim-fade-up delay-1">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Split breakdown</p>
            {membersWithAmounts.length === 0 ? (
              <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3">
                <AlertCircle size={18} className="text-slate-300 shrink-0" />
                <p className="text-sm text-slate-400">No items assigned — go back and assign members to items.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 stagger">
                {membersWithAmounts.map(m => {
                  const color = memberColor(m.name);
                  return (
                    <div key={m.id} className="bg-white rounded-xl px-4 py-3 flex items-center gap-3 border border-slate-100 shadow-sm anim-fade-up card-lift">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-extrabold text-sm shrink-0"
                        style={{ background: color }}>
                        {m.name?.[0]?.toUpperCase()}
                      </div>
                      <span className="flex-1 font-semibold text-sm text-slate-700">{m.name}</span>
                      <span className="font-extrabold text-base" style={{ color }}>${m.amount.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Who paid */}
          <div className="anim-fade-up delay-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Who paid?</p>
            <div className="flex flex-wrap gap-2">
              {members.map(m => {
                const mid      = String(m.id);
                const color    = memberColor(m.name);
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
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Payment split</p>
                {payerIds.length > 1 && (
                  <button onClick={resetEqual}
                    className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg transition-colors hover:bg-indigo-50"
                    style={{ color: INDIGO }}>
                    <Equal size={12} /> Equal
                  </button>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                {payerIds.map((mid, idx) => {
                  const m     = members.find(m => String(m.id) === mid);
                  const color = memberColor(m?.name || '');
                  return (
                    <div key={mid}
                      className={`flex items-center gap-3 px-4 py-3 ${idx < payerIds.length - 1 ? 'border-b border-slate-100' : ''}`}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-extrabold text-xs shrink-0"
                        style={{ background: color }}>
                        {m?.name?.[0]?.toUpperCase()}
                      </div>
                      <span className="flex-1 font-semibold text-sm text-slate-700">{m?.name}</span>
                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                        <span className="text-xs text-slate-400 font-semibold">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={paidAmounts[mid]}
                          onChange={e => updateAmount(mid, e.target.value)}
                          className="w-20 text-sm font-bold text-slate-800 bg-transparent outline-none text-right"
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
              ? <><Loader2 size={20} className="animate-spin" /> Posting…</>
              : <><CloudUpload size={20} /> Post to Splitwise</>}
          </button>
        </div>
      </div>
    </div>
  );
}
