import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';
import { loadTransactions } from '../services/db';

const INDIGO = '#6366f1';

// The reverse of SplitwisePickerModal — instead of picking a Splitwise
// expense to attach to a known bank transaction, this picks a bank
// transaction to attach a just-posted Splitwise expense to. Used right
// after ApprovePage successfully posts a scanned receipt, so the receipt
// and its card charge don't show up as two separate unmatched things in
// Statements. expense: the just-posted expense {id, cost, description,
// date}. onSelect(transaction) / onSkip.
export default function TransactionPickerModal({ expense, onSelect, onSkip }) {
  const [search, setSearch] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadTransactions()
      .then(txns => { if (!cancelled) setTransactions(txns); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const cost = Math.abs(parseFloat(expense.cost || 0));

  const sorted = useMemo(() => {
    const filtered = transactions.filter(t => {
      // A receipt you paid for shows up as a DEBIT on your card, never a
      // credit/payment/pending row — narrowing to just those keeps the list
      // to plausible candidates instead of every transaction ever synced.
      if (t.isCredit || t.isPayment || t.isPending) return false;
      if (!search) return true;
      return (t.description || '').toLowerCase().includes(search.toLowerCase());
    });
    return filtered
      .sort((a, b) => Math.abs((a.amount || 0) - cost) - Math.abs((b.amount || 0) - cost))
      .slice(0, 40);
  }, [transactions, search, cost]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onSkip()}>
      <div className="bg-surface rounded-t-3xl max-h-[80vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-extrabold text-ink text-sm">Match to a bank transaction?</p>
                {loading && <Loader2 size={12} className="text-subtle animate-spin shrink-0" />}
              </div>
              <p className="text-xs text-subtle mt-0.5">Optional — link the card charge this receipt is for, so it shows up matched in Statements.</p>
            </div>
            <button onClick={onSkip} className="p-1.5 rounded-lg text-subtle hover:text-muted">
              <X size={18} />
            </button>
          </div>

          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search transactions…"
              autoFocus
              className="w-full bg-surface-alt border border-edge rounded-xl pl-8 pr-3 py-2.5 text-sm text-ink outline-none focus:border-indigo-300"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {sorted.length === 0 && !loading ? (
            <p className="text-subtle text-sm text-center py-8">No transactions found</p>
          ) : (
            sorted.map(txn => {
              const amtDiff     = Math.abs((txn.amount || 0) - cost);
              const isClose     = amtDiff < cost * 0.1;
              const alreadyLinked = !!(txn.overrideSplitwiseIds?.length || txn.overrideSplitwiseId);
              return (
                <button
                  key={txn.id}
                  onClick={() => onSelect(txn)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-alt transition-colors text-left"
                >
                  <span className="text-lg shrink-0">{getCategoryIcon(txn.category)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{txn.description}</p>
                    <p className="text-xs text-subtle mt-0.5 truncate">
                      {formatShortDate(txn.date)} · {txn.sourceName || txn.source}
                      {alreadyLinked && <span className="ml-1.5" style={{ color: INDIGO }}>· already linked</span>}
                    </p>
                  </div>
                  <p className={`text-sm font-bold shrink-0 ${isClose ? 'text-emerald-500' : 'text-ink'}`}>{formatCurrency(txn.amount)}</p>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-3 border-t border-edge">
          <button
            onClick={onSkip}
            className="w-full py-3 rounded-2xl text-sm font-bold text-muted border border-edge hover:bg-surface-alt transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
