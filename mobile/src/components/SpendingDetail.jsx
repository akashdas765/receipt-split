import React, { useState } from 'react';
import { X } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';

const SORTS = [
  { key: 'amount', label: 'Amount' },
  { key: 'date',   label: 'Date' },
];

// Breakdown sheet opened by tapping the Spending card on HomePage — the
// same Rent & Utilities / Misc split shown on the card face, expanded into
// the actual transaction lists behind each number. One sort toggle shared
// by all sections rather than one each, so switching order doesn't leave
// them inconsistent with each other.
export default function SpendingDetail({ total, subtitle, rentUtilTxns, rentUtilTotal, miscTxns, miscTotal, splitwiseTxns = [], splitwiseTotal = 0, onClose }) {
  const [sortBy, setSortBy] = useState('amount');
  const hasAny = rentUtilTxns.length + miscTxns.length + splitwiseTxns.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge flex items-start justify-between">
          <div>
            <p className="font-extrabold text-ink text-sm">Actual spend</p>
            <p className="text-xl font-extrabold text-ink mt-0.5">{formatCurrency(total)}</p>
            {subtitle && <p className="text-xs text-subtle mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted shrink-0">
            <X size={18} />
          </button>
        </div>

        {hasAny && (
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

        <div className="overflow-y-auto px-4 py-4 space-y-5">
          <Section title="Rent & Utilities" total={rentUtilTotal} txns={rentUtilTxns} sortBy={sortBy} />
          <Section title="Misc" total={miscTotal} txns={miscTxns} sortBy={sortBy} />
          {splitwiseTxns.length > 0 && (
            <div>
              <Section title="Splitwise · paid by someone else" total={splitwiseTotal} txns={splitwiseTxns} sortBy={sortBy} />
              <p className="text-[10px] text-subtle mt-1.5">Paid directly by someone else, not out of your bank account — still counted in Actual spend above since it&rsquo;s your share of real money spent.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, total, txns, sortBy }) {
  // Defaults to highest-cost-first — "what's actually driving this number"
  // — same intent as the total up top; the Sort toggle above switches this
  // to date order instead.
  const sorted = [...txns].sort((a, b) =>
    sortBy === 'date'
      ? (b.date || '').localeCompare(a.date || '')
      : (b.effectiveAmount || 0) - (a.effectiveAmount || 0)
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-bold text-subtle uppercase tracking-wide">{title}</p>
        <p className="text-xs font-bold text-ink">{formatCurrency(total)}</p>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-subtle py-2">Nothing here</p>
      ) : (
        <div className="bg-surface rounded-xl border border-edge divide-y divide-slate-50 px-3">
          {sorted.map(t => (
            <div key={t.id} className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0">
                <p className="text-sm text-ink truncate">{t.description || 'Unknown'}</p>
                <p className="text-[10px] text-subtle truncate">
                  {formatShortDate(t.date)} · {t.sourceName || t.source}
                  {t.isSplitwised && t.originalAmount > t.effectiveAmount && ` · your share of ${formatCurrency(t.originalAmount)}`}
                </p>
              </div>
              <span className="text-sm font-semibold text-ink shrink-0">{formatCurrency(t.effectiveAmount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
