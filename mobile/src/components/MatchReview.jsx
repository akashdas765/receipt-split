import React, { useState } from 'react';
import { Link2, Unlink, CheckCircle2, AlertCircle, Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';

const INDIGO = '#6366f1';

// matched: bank rows only (isSplitOnly filtered out by the caller) already
// run through utils/matcher.js's matchTransactions.
export default function MatchReview({ matched, groupName, monthRange, onLink, onUnlink, onClearOverride }) {
  const [filter,   setFilter]   = useState(0); // 0=All 1=Unmatched 2=Matched
  const [expanded, setExpanded] = useState({});

  const matchedTxns   = matched.filter(t => t.isSplitwised);
  const unmatchedTxns = matched.filter(t => !t.isSplitwised);
  const displayed     = filter === 1 ? unmatchedTxns : filter === 2 ? matchedTxns : matched;

  const effectiveTotal = matched.reduce((s, t) => s + (t.effectiveAmount || 0), 0);
  const grossTotal     = matched.reduce((s, t) => s + (t.originalAmount || t.amount || 0), 0);
  const savedTotal     = matchedTxns.reduce((s, t) => s + (t.savings || 0), 0);

  if (!matched.length) {
    return (
      <div className="text-center py-10 text-sm text-slate-400">
        <p>Upload a bank statement first,</p>
        <p className="mt-1">then come back here to review matches.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Live balance card */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">My balance — {monthRange.label}</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-extrabold text-slate-800">{formatCurrency(effectiveTotal)}</p>
            <p className="text-xs text-slate-400 mt-0.5">of {formatCurrency(grossTotal)} gross</p>
          </div>
          {savedTotal > 0.5 && (
            <div className="text-right">
              <p className="text-sm font-bold text-emerald-500">-{formatCurrency(savedTotal)}</p>
              <p className="text-xs text-slate-400">saved via splits</p>
            </div>
          )}
        </div>
        {grossTotal > 0 && (
          <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min((effectiveTotal / grossTotal) * 100, 100)}%`, background: INDIGO }} />
          </div>
        )}
        <p className="text-xs text-slate-400 mt-1.5">{matchedTxns.length} matched · {unmatchedTxns.length} unmatched</p>
      </div>

      {/* Filter chips */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'All', value: matched.length, active: filter === 0, onClick: () => setFilter(0), color: 'text-slate-800' },
          { label: '✅ Matched', value: matchedTxns.length, active: filter === 2, onClick: () => setFilter(2), color: 'text-emerald-500' },
          { label: '⚠️ Unmatched', value: unmatchedTxns.length, active: filter === 1, onClick: () => setFilter(1), color: 'text-amber-500' },
        ].map(c => (
          <button key={c.label} onClick={c.onClick}
            className={`rounded-xl px-2 py-2.5 text-center border transition-colors ${c.active ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
            <p className={`font-extrabold text-base ${c.color}`}>{c.value}</p>
            <p className="text-xs text-slate-400 mt-0.5 leading-tight">{c.label}</p>
          </button>
        ))}
      </div>

      {filter !== 2 && unmatchedTxns.length > 0 && (
        <p className="text-xs text-slate-400">
          Tap <span className="font-semibold" style={{ color: INDIGO }}>Link</span> on any unmatched transaction to connect it to a Splitwise expense.
        </p>
      )}

      {/* Transaction list */}
      <div className="space-y-2">
        {displayed.map(txn => {
          const isOpen       = expanded[txn.id];
          const isOverridden = txn.manualOverride;

          return (
            <div key={txn.id} className={`rounded-2xl overflow-hidden border bg-white ${txn.isSplitwised ? 'border-emerald-100' : 'border-amber-100'}`}>
              <button className="w-full flex items-center gap-3 p-3 text-left" onClick={() => setExpanded(p => ({ ...p, [txn.id]: !p[txn.id] }))}>
                <div className="shrink-0">
                  {txn.isSplitwised ? <CheckCircle2 size={18} className="text-emerald-500" /> : <AlertCircle size={18} className="text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{getCategoryIcon(txn.category)}</span>
                    <p className="text-sm font-semibold text-slate-700 truncate">{txn.description}</p>
                    {isOverridden && <span className="text-xs bg-indigo-50 px-1.5 rounded-full shrink-0" style={{ color: INDIGO }}>manual</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatShortDate(txn.date)}
                    {txn.isSplitwised && (
                      <span className="ml-1.5 text-emerald-500">
                        · {txn.splitwiseDesc}{groupName(txn.groupId) ? ` · ${groupName(txn.groupId)}` : ''}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0 mr-1">
                  <p className="text-sm font-bold text-slate-800">{formatCurrency(txn.effectiveAmount)}</p>
                  {txn.isSplitwised && txn.savings > 0.5 && <p className="text-xs text-emerald-500">-{formatCurrency(txn.savings)}</p>}
                </div>
                {isOpen ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 px-3 pb-3 pt-2 space-y-2">
                  {txn.isSplitwised ? (
                    <div className="bg-emerald-50 rounded-xl p-2.5 space-y-1">
                      <p className="text-emerald-600 text-xs font-semibold">✅ Matched to Splitwise</p>
                      <Row label="Expense" value={txn.splitwiseDesc} />
                      <Row label="Your share" value={formatCurrency(txn.effectiveAmount)} valueClass="text-emerald-600 font-semibold" />
                      <Row label="You save" value={`-${formatCurrency(txn.savings)}`} valueClass="text-emerald-600" />
                      {groupName(txn.groupId) && <Row label="Group" value={groupName(txn.groupId)} />}
                      {!txn.manualOverride && <Row label="Confidence" value={`${txn.matchScore}%`} />}
                    </div>
                  ) : (
                    <div className="bg-amber-50 rounded-xl p-2.5">
                      <p className="text-amber-600 text-xs">No Splitwise match — full amount counts as personal expense.</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    {txn.isSplitwised ? (
                      <>
                        <button onClick={() => { onUnlink(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-600 border border-amber-200 rounded-xl py-2 hover:bg-amber-50 transition-colors">
                          <Unlink size={13} /> Unlink
                        </button>
                        <button onClick={() => { onLink(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border rounded-xl py-2 transition-colors" style={{ color: INDIGO, borderColor: '#c7d2fe' }}>
                          <Pencil size={13} /> Change link
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { onLink(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border rounded-xl py-2 transition-colors" style={{ color: INDIGO, borderColor: '#c7d2fe' }}>
                          <Link2 size={13} /> Link to Splitwise
                        </button>
                        {isOverridden && (
                          <button onClick={() => onClearOverride(txn)} className="flex items-center justify-center gap-1 text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50 transition-colors">
                            Auto
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value, valueClass = 'text-slate-700' }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}
