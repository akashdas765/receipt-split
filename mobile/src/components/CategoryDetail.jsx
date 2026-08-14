import React, { useState } from 'react';
import { X } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';

const SORTS = [
  { key: 'amount', label: 'Amount' },
  { key: 'date',   label: 'Date' },
];

// Bottom sheet opened by tapping a category (or merchant) row in
// InsightsPage's "By category"/"Top merchants" lists — same pattern as
// HomePage's SpendingDetail (tap a total, see the actual line items behind
// it), just single-section since a category/merchant has one flat list
// rather than Rent&Utilities/Misc/Splitwise buckets. items:
// stats.itemizedTransactions already filtered to this category or merchant
// — see computeStats in services/insights.js for how each entry's date/
// description/source/amount (and id/kind/accountSource, used by onSelect
// to route to the right editor) is assembled from receipts, matched bank
// transactions, and Splitwise-only expenses. `category` doubles as the
// header label for either use (a merchant name isn't a real category, so
// pass `icon` explicitly in that case — it otherwise defaults to
// getCategoryIcon(category), which falls back to a generic box for an
// unrecognized string). onSelect is optional — omit it to keep rows static
// (e.g. if a caller doesn't have enough context to navigate anywhere
// useful).
export default function CategoryDetail({ category, icon, total, items, onClose, onSelect }) {
  const [sortBy, setSortBy] = useState('amount');
  const sorted = [...items].sort((a, b) =>
    sortBy === 'date'
      ? (b.date || '').localeCompare(a.date || '')
      : (b.amount || 0) - (a.amount || 0)
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge flex items-start justify-between">
          <div>
            <p className="font-extrabold text-ink text-sm">{icon ?? getCategoryIcon(category)} {category}</p>
            <p className="text-xl font-extrabold text-ink mt-0.5">{formatCurrency(total)}</p>
            <p className="text-xs text-subtle mt-0.5">{items.length} item{items.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted shrink-0">
            <X size={18} />
          </button>
        </div>

        {items.length > 1 && (
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

        <div className="overflow-y-auto px-4 py-4">
          {sorted.length === 0 ? (
            <p className="text-xs text-subtle py-2">Nothing here</p>
          ) : (
            <div className="bg-surface rounded-xl border border-edge divide-y divide-slate-50 px-3">
              {sorted.map((t, i) => (
                <button
                  key={i}
                  onClick={() => onSelect?.(t)}
                  disabled={!onSelect || !t.id}
                  className="w-full flex items-center justify-between py-2 gap-3 text-left disabled:cursor-default hover:enabled:bg-surface-alt -mx-3 px-3 rounded-lg transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">{t.description || 'Unknown'}</p>
                    <p className="text-[10px] text-subtle truncate">{formatShortDate(t.date)} · {t.source}</p>
                  </div>
                  <span className="text-sm font-semibold text-ink shrink-0">{formatCurrency(t.amount)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
