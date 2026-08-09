import React from 'react';
import { ArrowLeftRight, Check, X, Unlink } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';

const INDIGO = '#6366f1';

// Money moving between the user's own accounts — not spend, not income.
// Tier 1 (pairs) and Tier 2 (hints) both land here as *candidates* only —
// amount+date pairing alone isn't proof (two unrelated charges on
// different cards can coincidentally match), so neither tier is treated as
// a confirmed transfer anywhere else in the app (Splitwise-exclusion aside)
// until the user taps Confirm here. Confirmed rows get a lightweight
// "not a transfer, undo" escape hatch instead.
export default function TransfersList({ pairs, hints, monthRange, onConfirm, onDismiss, onConfirmPair, onUnpair }) {
  const unconfirmedPairs = pairs.filter(p => !p.confirmed);
  const confirmedPairs   = pairs.filter(p => p.confirmed);
  const unconfirmedHints = hints.filter(h => !h.confirmed);
  const confirmedHints   = hints.filter(h => h.confirmed);

  if (!pairs.length && !hints.length) {
    return (
      <div className="text-center py-10 text-sm text-slate-400">
        <p>No transfers detected for {monthRange.label}.</p>
        <p className="mt-1">Money moved between your own accounts shows up here instead of counting as spend or income.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {confirmedPairs.map(pair => (
        <div key={`pair-${pair.debit.id}-${pair.credit.id}`} className="rounded-2xl border border-indigo-100 bg-white p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#eef1fb' }}>
            <ArrowLeftRight size={14} style={{ color: INDIGO }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-700 truncate">
              Transferred from {pair.debit.sourceName || pair.debit.source} to {pair.credit.sourceName || pair.credit.source}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">{formatShortDate(pair.debit.date)}</p>
          </div>
          <p className="text-sm font-bold text-slate-800 shrink-0">{formatCurrency(pair.debit.amount)}</p>
          <button
            onClick={() => onUnpair(pair)}
            title="Not a transfer? Undo"
            className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
          >
            <Unlink size={13} />
          </button>
        </div>
      ))}

      {confirmedHints.map(h => (
        <div key={`hint-confirmed-${h.txn.id}`} className="rounded-2xl border border-indigo-100 bg-white p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#eef1fb' }}>
            <ArrowLeftRight size={14} style={{ color: INDIGO }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-700 truncate">{h.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{formatShortDate(h.txn.date)}</p>
          </div>
          <p className="text-sm font-bold text-slate-800 shrink-0">{formatCurrency(h.txn.amount)}</p>
        </div>
      ))}

      {unconfirmedPairs.map(pair => (
        <div key={`pair-${pair.debit.id}-${pair.credit.id}`} className="rounded-2xl border border-amber-100 bg-white p-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
              <ArrowLeftRight size={14} className="text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">
                {pair.debit.sourceName || pair.debit.source} → {pair.credit.sourceName || pair.credit.source}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">"{pair.debit.description}" → "{pair.credit.description}"</p>
              <p className="text-xs text-amber-500 mt-0.5">Possible transfer · {formatShortDate(pair.debit.date)}</p>
            </div>
            <p className="text-sm font-bold text-slate-800 shrink-0">{formatCurrency(pair.debit.amount)}</p>
          </div>
          <div className="flex gap-2 pt-2 mt-2 border-t border-slate-100">
            <button
              onClick={() => onUnpair(pair)}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl py-2 hover:bg-slate-50 transition-colors"
            >
              <X size={13} /> Not a transfer
            </button>
            <button
              onClick={() => onConfirmPair(pair)}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-white rounded-xl py-2 transition-colors"
              style={{ background: INDIGO }}
            >
              <Check size={13} /> Confirm transfer
            </button>
          </div>
        </div>
      ))}

      {unconfirmedHints.map(h => (
        <div key={`hint-${h.txn.id}`} className="rounded-2xl border border-amber-100 bg-white p-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
              <ArrowLeftRight size={14} className="text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">{h.label}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">"{h.txn.description}"</p>
              <p className="text-xs text-amber-500 mt-0.5">Possible transfer · {formatShortDate(h.txn.date)}</p>
            </div>
            <p className="text-sm font-bold text-slate-800 shrink-0">{formatCurrency(h.txn.amount)}</p>
          </div>
          <div className="flex gap-2 pt-2 mt-2 border-t border-slate-100">
            <button
              onClick={() => onDismiss(h.txn)}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl py-2 hover:bg-slate-50 transition-colors"
            >
              <X size={13} /> Not a transfer
            </button>
            <button
              onClick={() => onConfirm(h.txn)}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-white rounded-xl py-2 transition-colors"
              style={{ background: INDIGO }}
            >
              <Check size={13} /> Confirm transfer
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
