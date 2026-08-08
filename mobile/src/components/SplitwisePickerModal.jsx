import React, { useState, useMemo, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';
import { fetchAllExpenses } from '../services/splitwise';

const INDIGO = '#6366f1';

// transaction: the bank txn being linked. myId: current Splitwise user id.
// groups: [{id,name}]. onSelect(expense) / onClose.
export default function SplitwisePickerModal({ transaction, myId, groups, initialExpenses, onSelect, onClose }) {
  const [search,   setSearch]   = useState('');
  const [paidOnly, setPaidOnly] = useState(true);
  const [allExpenses, setAllExpenses] = useState(initialExpenses || []);
  const [loading, setLoading] = useState(true);

  const groupName = id => groups.find(g => g.id === id)?.name;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { expenses } = await fetchAllExpenses(myId);
        if (!cancelled) setAllExpenses(expenses);
      } catch {
        // keep whatever we started with
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [myId]);

  const sorted = useMemo(() => {
    const txnAmt = Math.abs(transaction.amount || 0);
    return [...allExpenses]
      .filter(e => {
        if (paidOnly && !(e.myPaidShare > 0)) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return e.description?.toLowerCase().includes(q) || groupName(e.group_id)?.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const da = Math.abs(parseFloat(a.cost) - txnAmt);
        const db = Math.abs(parseFloat(b.cost) - txnAmt);
        if (Math.abs(da - db) < 1) return (b.date || '').localeCompare(a.date || '');
        return da - db;
      });
  }, [allExpenses, search, paidOnly, transaction.amount]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl max-h-[80vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-extrabold text-slate-800 text-sm">Link to Splitwise</p>
                {loading && <Loader2 size={12} className="text-slate-400 animate-spin shrink-0" />}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {transaction.description} · {formatCurrency(transaction.amount)}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setPaidOnly(v => !v)}
              className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${paidOnly ? 'text-white' : 'bg-white border-slate-200 text-slate-500'}`}
              style={paidOnly ? { background: INDIGO, borderColor: INDIGO } : {}}
            >
              💳 Paid by me
            </button>
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search expenses…"
                autoFocus
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300"
              />
            </div>
          </div>
        </div>

        {!loading && (
          <div className="px-4 py-1.5 border-b border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {sorted.length} expense{sorted.length !== 1 ? 's' : ''}{paidOnly ? ' paid by you' : ''}
            </p>
            {paidOnly && <button onClick={() => setPaidOnly(false)} className="text-xs text-slate-400 hover:text-slate-600">Show all</button>}
          </div>
        )}

        <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {sorted.length === 0 && !loading ? (
            <p className="text-slate-400 text-sm text-center py-8">No expenses found</p>
          ) : (
            sorted.map(exp => {
              const amtDiff = Math.abs(parseFloat(exp.cost) - Math.abs(transaction.amount || 0));
              const isClose = amtDiff < parseFloat(exp.cost) * 0.1;
              return (
                <button
                  key={exp.id}
                  onClick={() => onSelect(exp)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <span className="text-lg shrink-0">{getCategoryIcon(exp.category)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{exp.description}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatShortDate(exp.date)}{groupName(exp.group_id) && <span className="ml-1.5">· {groupName(exp.group_id)}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className={`text-sm font-bold ${isClose ? 'text-emerald-500' : 'text-slate-800'}`}>{formatCurrency(exp.myOwedShare)}</p>
                    <p className="text-xs text-slate-400">of {formatCurrency(exp.cost)}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
