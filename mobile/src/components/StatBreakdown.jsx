import React from 'react';
import { X } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';

// Generic drill-down sheet for a Statements stat card — "what transactions
// actually make up this number". The caller passes whichever list already
// fed the stat's own computation (so the sheet's total always matches the
// card that opened it) plus getAmount, which picks which field of each
// transaction to show as the row's headline value — effectiveAmount for
// "Actual spend", savings for "Amount saved", amount for "Payments made".
export default function StatBreakdown({ title, subtitle, transactions, getAmount, total, onClose }) {
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

        <div className="overflow-y-auto px-4 py-3 space-y-2">
          {transactions.length === 0 ? (
            <p className="text-center text-sm text-subtle py-8">Nothing here</p>
          ) : (
            transactions.map(t => (
              <div key={t.id} className="flex items-center gap-3 bg-surface rounded-xl px-3 py-2.5 border border-edge shadow-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{t.description || 'Unknown'}</p>
                  <p className="text-xs text-subtle mt-0.5">{formatShortDate(t.date)} · {t.sourceName || t.source}</p>
                </div>
                <p className="text-sm font-bold text-ink shrink-0">{formatCurrency(getAmount(t))}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
