import React from 'react';
import { X, Users, Calendar, Tag } from 'lucide-react';
import { memberColor } from '../utils/memberColor';

// View-only detail sheet for a Splitwise expense not created through this
// app (HomePage's "splitwiseOnly"/"foreignCurrencyOnly" cards) — shows
// exactly what fetchAllExpenses pulls from Splitwise: the full per-member
// paid/owed breakdown, not just the current user's own share. No edit or
// delete here — this app didn't create the expense, Splitwise did.
export default function SplitwiseExpenseDetail({ expense, groupName, onClose }) {
  const splits = (expense.splits || []).filter(s => (s.paidShare || 0) > 0 || (s.owedShare || 0) > 0);
  const fmt = (n) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: expense.currency_code || 'USD' }).format(n);
    } catch {
      return `${expense.currency_code || 'USD'} ${(n || 0).toFixed(2)}`;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-extrabold text-ink text-sm truncate">{expense.description || 'Splitwise expense'}</p>
            <p className="text-xl font-extrabold text-ink mt-0.5">{fmt(expense.cost)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-4">
          <div className="bg-surface rounded-xl border border-edge divide-y divide-slate-50 px-3">
            <Row icon={<Calendar size={13} />} label="Date" value={expense.date} />
            {groupName && <Row icon={<Users size={13} />} label="Group" value={groupName} />}
            {expense.category && <Row icon={<Tag size={13} />} label="Category" value={expense.category} />}
            {expense.addedBy && <Row label="Added by" value={expense.addedBy} />}
          </div>

          <div className="bg-surface rounded-xl border border-edge divide-y divide-slate-50 px-3">
            <Row label="Your paid share" value={fmt(expense.myPaidShare)} valueClass={expense.myPaidShare > 0 ? 'text-emerald-600' : undefined} />
            <Row label="Your owed share" value={fmt(expense.myOwedShare)} />
            <Row
              label="Your net balance"
              value={`${expense.myNetBalance >= 0 ? '+' : ''}${fmt(expense.myNetBalance)}`}
              valueClass={expense.myNetBalance >= 0 ? 'text-emerald-600' : 'text-red-500'}
            />
          </div>

          {splits.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-subtle uppercase tracking-wide mb-1.5">Split between</p>
              <div className="bg-surface rounded-xl border border-edge divide-y divide-slate-50 px-3">
                {splits.map(s => {
                  const color = memberColor(s.id, splits);
                  return (
                    <div key={s.id} className="flex items-center gap-3 py-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-extrabold shrink-0" style={{ background: color }}>
                        {s.name?.[0]?.toUpperCase()}
                      </div>
                      <span className="flex-1 text-sm font-semibold text-ink truncate">{s.name}</span>
                      <div className="text-right shrink-0">
                        {s.paidShare > 0 && <p className="text-xs text-emerald-600">paid {fmt(s.paidShare)}</p>}
                        <p className="text-xs text-subtle">owes {fmt(s.owedShare)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, value, valueClass = 'text-ink' }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="flex items-center gap-1.5 text-sm text-muted">{icon}{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
