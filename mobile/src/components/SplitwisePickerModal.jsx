import React, { useState, useMemo, useEffect } from 'react';
import { Search, X, Loader2, DollarSign, Clock, Check } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';
import { fetchAllExpenses } from '../services/splitwise';

const INDIGO = '#6366f1';

// transaction: the bank txn being linked. myId: current Splitwise user id.
// groups: [{id,name}]. selectedIds: expense ids already linked to this
// transaction (pre-checked, for the "Change link" entry point). Multi-
// select rather than tap-to-close-immediately — a single card charge
// sometimes shows up as more than one separate Splitwise expense (e.g.
// split across two group purchases), so linking has to allow more than
// one. onConfirm(expenses[]) / onClose.
export default function SplitwisePickerModal({ transaction, myId, groups, initialExpenses, selectedIds = [], onConfirm, onClose }) {
  const [search,   setSearch]   = useState('');
  const [paidOnly, setPaidOnly] = useState(true);
  const [allExpenses, setAllExpenses] = useState(initialExpenses || []);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set(selectedIds));
  // 'amount' (closest cost to the bank txn — a good default when browsing)
  // or 'date' (newest first — what you actually want once you've typed a
  // search, since by then you already know it's e.g. "Enterprise Rent-A-
  // Car" and just want the recent one, not whichever past visit happened
  // to cost the closest amount).
  const [sortBy, setSortBy] = useState('amount');

  const groupName = id => groups.find(g => g.id === id)?.name;

  const hasSearch = search.trim().length > 0;
  useEffect(() => { setSortBy(hasSearch ? 'date' : 'amount'); }, [hasSearch]);

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
    const filtered = [...allExpenses].filter(e => {
      if (selected.has(e.id)) return true; // already-picked stays visible regardless of filters
      if (paidOnly && !(e.myPaidShare > 0)) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return e.description?.toLowerCase().includes(q) || groupName(e.group_id)?.toLowerCase().includes(q);
    });
    if (sortBy === 'date') {
      return filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }
    return filtered.sort((a, b) => {
      const da = Math.abs(parseFloat(a.cost) - txnAmt);
      const db = Math.abs(parseFloat(b.cost) - txnAmt);
      if (Math.abs(da - db) < 1) return (b.date || '').localeCompare(a.date || '');
      return da - db;
    });
  }, [allExpenses, search, paidOnly, transaction.amount, sortBy, selected]);

  const toggle = id => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const confirm = () => {
    const chosen = allExpenses.filter(e => selected.has(e.id));
    onConfirm(chosen);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[80vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-extrabold text-ink text-sm">Link to Splitwise</p>
                {loading && <Loader2 size={12} className="text-subtle animate-spin shrink-0" />}
              </div>
              <p className="text-xs text-subtle mt-0.5 truncate">
                {transaction.description} · {formatCurrency(transaction.amount)}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted">
              <X size={18} />
            </button>
          </div>

          <p className="text-xs text-subtle mt-2">Tap to select — pick more than one if this charge was split across several Splitwise expenses.</p>

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setPaidOnly(v => !v)}
              className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${paidOnly ? 'text-white' : 'bg-surface border-edge text-muted'}`}
              style={paidOnly ? { background: INDIGO, borderColor: INDIGO } : {}}
            >
              💳 Paid by me
            </button>
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search expenses…"
                autoFocus
                className="w-full bg-surface-alt border border-edge rounded-xl pl-8 pr-3 py-2.5 text-sm text-ink outline-none focus:border-indigo-300"
              />
            </div>
          </div>
        </div>

        {!loading && (
          <div className="px-4 py-1.5 border-b border-edge flex items-center justify-between gap-2">
            <p className="text-xs text-subtle shrink-0">
              {sorted.length} expense{sorted.length !== 1 ? 's' : ''}{paidOnly ? ' paid by you' : ''}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex rounded-lg border border-edge overflow-hidden">
                <button
                  onClick={() => setSortBy('amount')}
                  title="Sort by closest amount"
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] font-semibold transition-colors ${sortBy === 'amount' ? 'text-white' : 'bg-surface text-muted hover:bg-surface-alt'}`}
                  style={sortBy === 'amount' ? { background: INDIGO } : {}}
                >
                  <DollarSign size={11} /> Amount
                </button>
                <button
                  onClick={() => setSortBy('date')}
                  title="Sort by most recent"
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] font-semibold transition-colors ${sortBy === 'date' ? 'text-white' : 'bg-surface text-muted hover:bg-surface-alt'}`}
                  style={sortBy === 'date' ? { background: INDIGO } : {}}
                >
                  <Clock size={11} /> Date
                </button>
              </div>
              {paidOnly && <button onClick={() => setPaidOnly(false)} className="text-xs text-subtle hover:text-muted">Show all</button>}
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {sorted.length === 0 && !loading ? (
            <p className="text-subtle text-sm text-center py-8">No expenses found</p>
          ) : (
            sorted.map(exp => {
              const amtDiff = Math.abs(parseFloat(exp.cost) - Math.abs(transaction.amount || 0));
              const isClose = amtDiff < parseFloat(exp.cost) * 0.1;
              const isSelected = selected.has(exp.id);
              return (
                <button
                  key={exp.id}
                  onClick={() => toggle(exp.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${isSelected ? 'bg-indigo-50' : 'hover:bg-surface-alt'}`}
                >
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? '' : 'border-edge'}`}
                    style={isSelected ? { background: INDIGO, borderColor: INDIGO } : {}}>
                    {isSelected && <Check size={13} className="text-white" />}
                  </div>
                  <span className="text-lg shrink-0">{getCategoryIcon(exp.category)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{exp.description}</p>
                    <p className="text-xs text-subtle mt-0.5">
                      {formatShortDate(exp.date)}{groupName(exp.group_id) && <span className="ml-1.5">· {groupName(exp.group_id)}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className={`text-sm font-bold ${isClose ? 'text-emerald-500' : 'text-ink'}`}>{formatCurrency(exp.myOwedShare)}</p>
                    <p className="text-xs text-subtle">of {formatCurrency(exp.cost)}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-3 border-t border-edge">
          <button
            onClick={confirm}
            disabled={selected.size === 0}
            className="w-full py-3 rounded-2xl text-white font-bold text-sm transition-colors btn-press disabled:opacity-40"
            style={{ background: INDIGO }}
          >
            {selected.size === 0 ? 'Select at least one expense' : `Link ${selected.size} expense${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
