import React, { useState } from 'react';
import { X } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';

const SORTS = [
  { key: 'amount', label: 'Amount' },
  { key: 'date',   label: 'Date' },
];

// Generic drill-down sheet for a Statements stat card — "what transactions
// actually make up this number". The caller passes whichever list already
// fed the stat's own computation (so the sheet's total always matches the
// card that opened it) plus getAmount, which picks which field of each
// transaction to show as the row's headline value — effectiveAmount for
// "Actual spend", savings for "Amount saved", amount for "Payments made".
// Defaults to highest-amount-first (what's actually driving the total),
// with a toggle to switch to date order instead. onSelect is optional —
// omit it to keep rows static (matches CategoryDetail's own onSelect
// convention on Insights, same "tap a line item to go find it" behavior
// here: StatementsPage wires it to switch to the Transactions tab and
// expand/scroll to that row via TransactionsList's initialExpandedId).
export default function StatBreakdown({ title, subtitle, transactions, getAmount, total, onClose, onSelect }) {
  const [sortBy, setSortBy] = useState('amount');
  const sorted = [...transactions].sort((a, b) =>
    sortBy === 'date'
      ? (b.date || '').localeCompare(a.date || '')
      : (getAmount(b) || 0) - (getAmount(a) || 0)
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge flex items-start justify-between">
          <div>
            <p className="font-extrabold text-ink text-sm">{title}</p>
            <p className="text-xl font-extrabold text-ink mt-0.5">{formatCurrency(total)}</p>
            {subtitle && <p className="text-xs text-subtle mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted shrink-0">
            <X size={18} />
          </button>
        </div>

        {transactions.length > 1 && (
          <div className="flex items-center gap-1.5 px-4 pt-3">
            <span className="text-[10px] font-bold text-subtle uppercase tracking-wide mr-0.5">Sort</span>
            {SORTS.map(s => (
              <button
                key={s.key}
                onClick={() => setSortBy(s.key)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors btn-press ${sortBy === s.key ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-edge bg-surface text-muted hover:border-edge'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-y-auto px-4 py-3 space-y-2">
          {sorted.length === 0 ? (
            <p className="text-center text-sm text-subtle py-8">Nothing here</p>
          ) : (
            sorted.map(t => (
              <button
                key={t.id}
                onClick={() => onSelect?.(t)}
                disabled={!onSelect}
                className="w-full flex items-center gap-3 bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm text-left disabled:cursor-default hover:enabled:border-indigo-100 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{t.description || 'Unknown'}</p>
                  <p className="text-xs text-subtle mt-0.5">{formatShortDate(t.date)} · {t.sourceName || t.source}</p>
                </div>
                <p className="text-sm font-bold text-ink shrink-0">{formatCurrency(getAmount(t))}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
