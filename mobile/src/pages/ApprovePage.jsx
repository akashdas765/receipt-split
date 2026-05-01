import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, CloudUpload, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { postExpense } from '../services/splitwise';
import { saveReceipt } from '../services/db';

const INDIGO = '#6366f1';
const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#10b981','#f97316','#06b6d4','#84cc16','#a855f7'];

function memberColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export default function ApprovePage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { receiptId, groupId, members = [], personTotals = {}, grandTotal = 0, merchant } = state || {};

  const [paidBy,     setPaidBy]     = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  const membersWithAmounts = members
    .map(m => ({ ...m, amount: personTotals[String(m.id)] || 0 }))
    .filter(m => m.amount > 0);

  const submit = async () => {
    if (!paidBy) { setError('Please choose who paid the bill.'); return; }
    setError(''); setSubmitting(true);
    try {
      const activeMembers = members.filter(m => (personTotals[String(m.id)] || 0) > 0);
      await postExpense({
        description:  merchant || 'Receipt',
        groupId,
        paidById:     paidBy,
        personTotals: Object.fromEntries(
          Object.entries(personTotals).map(([k, v]) => [k, Math.round(v * 100) / 100])
        ),
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
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <span className="font-extrabold text-slate-800">Review & Post</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-28 space-y-5">

          {/* Total card */}
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center border border-slate-100 shadow-sm">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
              style={{ background: '#e0e7ff' }}>
              <CloudUpload size={26} style={{ color: INDIGO }} />
            </div>
            <p className="font-bold text-slate-600 text-sm mb-1">{merchant || 'Receipt'}</p>
            <p className="font-extrabold text-4xl mb-1" style={{ color: INDIGO }}>${grandTotal.toFixed(2)}</p>
            <p className="text-xs text-slate-400">Total including tax</p>
          </div>

          {/* Split breakdown */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Split breakdown</p>
            {membersWithAmounts.length === 0 ? (
              <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3">
                <AlertCircle size={18} className="text-slate-300 shrink-0" />
                <p className="text-sm text-slate-400">No items assigned — go back and assign members to items.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {membersWithAmounts.map(m => {
                  const color = memberColor(m.name);
                  return (
                    <div key={m.id} className="bg-white rounded-xl px-4 py-3 flex items-center gap-3 border border-slate-100 shadow-sm">
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
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Who paid?</p>
            <div className="flex flex-wrap gap-2">
              {members.map(m => {
                const color    = memberColor(m.name);
                const selected = paidBy === m.id;
                return (
                  <button key={m.id} onClick={() => { setPaidBy(m.id); setError(''); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 font-semibold text-sm transition-all`}
                    style={selected
                      ? { borderColor: color, background: color + '18', color }
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

        </div>
      </main>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-10 bg-white border-t border-slate-100 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600 font-medium">{error}</p>
            </div>
          )}
          <button onClick={submit} disabled={submitting}
            className="w-full py-3.5 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: INDIGO, boxShadow: '0 4px 16px rgba(99,102,241,0.4)' }}>
            {submitting
              ? <><Loader2 size={20} className="animate-spin" /> Posting…</>
              : <><CloudUpload size={20} /> Post to Splitwise</>}
          </button>
        </div>
      </div>
    </div>
  );
}
