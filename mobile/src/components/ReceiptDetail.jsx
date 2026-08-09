import React from 'react';
import { X, CheckCircle2, Pencil } from 'lucide-react';
import { memberColor } from '../utils/memberColor';
import { normalizeItems, lineAmount, flattenShares } from '../utils/receiptItems';

// View-only detail sheet for an already-posted receipt, opened from
// HomePage. Shows the same total/split-breakdown/items summary
// DetailPage's edit form works from, but read-only — "Edit" hands off to
// that full form (navigate('/detail', {state: receipt})) instead of
// switching modes in place, so there's exactly one editing surface.
export default function ReceiptDetail({ receipt, groupName, onEdit, onClose }) {
  const items              = normalizeItems(receipt.items);
  const viewMembers        = receipt.members || [];
  const personTotals       = receipt.personTotals || {};
  const membersWithAmounts = viewMembers
    .map(m => ({ ...m, amount: personTotals[String(m.id)] || 0 }))
    .filter(m => m.amount > 0);
  const total = receipt.grandTotal ?? receipt.total ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-extrabold text-slate-800 text-sm truncate">{receipt.merchant || 'Receipt'}</p>
            <p className="text-xl font-extrabold text-slate-800 mt-0.5">${total.toFixed(2)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-white btn-gradient btn-press"
            >
              <Pencil size={13} /> Edit
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-5">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{receipt.date}</span>
            {groupName && <><span className="text-slate-200">·</span><span>{groupName}</span></>}
            <span className="ml-auto text-xs font-bold text-emerald-500 bg-emerald-50 px-2.5 py-1 rounded-full flex items-center gap-1">
              <CheckCircle2 size={11} /> Posted to Splitwise
            </span>
          </div>

          {membersWithAmounts.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Split breakdown</p>
              <div className="flex flex-col gap-2">
                {membersWithAmounts.map(m => {
                  const color = memberColor(m.id, viewMembers);
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
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Items</p>
            <div className="flex flex-col gap-2">
              {items.map(item => {
                const shares      = flattenShares(item);
                const assignedIds = Object.keys(shares).filter(id => shares[id] > 0);
                return (
                  <div key={item.id} className="bg-white rounded-xl p-3.5 border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-slate-800 truncate">{item.description}</p>
                      <p className="font-bold text-sm text-slate-800 shrink-0">${lineAmount(item).toFixed(2)}</p>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {item.quantity} × ${(parseFloat(item.unit_price) || 0).toFixed(2)}
                    </p>
                    {assignedIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {assignedIds.map(id => {
                          const m     = viewMembers.find(mm => String(mm.id) === id);
                          const color = memberColor(id, viewMembers);
                          const count = shares[id];
                          return (
                            <span key={id} className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: color + '22', color }}>
                              {m?.name || id}{count > 1 ? ` ×${count}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
